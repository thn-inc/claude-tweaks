#!/usr/bin/env node
'use strict';
// tools/step-yield-report.js — review yield over an archive of pipeline run directories (#5556).
//
//   node tools/step-yield-report.js <pipelines-root>... [--json] [--runs] [--window <N>] [--lane-floor <M>]
//
// Scans each root and its `archive/` subdirectory for run directories (every directory but one named
// `archive`) and totals the review counters of each run's step yield: findings raised, reported by both
// reviewers, reported by one, relabeled, tiebreak outcomes by verdict and by outcome, a per-lens table,
// and the share of review-step decision lines no reader recognised. A run's own `step-yield.json` is
// used when present; otherwise the yield is derived in memory (plugin/bin/lib/timing/step-yield.js).
// The tool only reads: it never writes under a root.
//
// It replaces tools/replay-scratch/review-yield.js, which matched the lines with its own regexes. The
// patterns now live in plugin/bin/lib/timing/pair-lines.js and console/resolve.js's parseTiebreakLine.
//
// Review lines: decision-file lines attributed to a step whose phase is `review` (the sum of its
// `decisions.*`: every entry line counts once there, structural lines excluded). The unparsed share is that step's
// `unparsed.count` over those lines. A second share adds the `unattributed` bucket's lines to both sides
// — an upper bound, since a line outside every span cannot be told apart from a review line there.
//
// Per-run rows (#5580): `--runs` adds `runs` (one row per run directory: closed state, start time, lane,
// the yield's steps as StepRows, the driver's own steps and its unparsed line count) to the JSON summary; `--window N` adds `window`
// (the N most recently started closed runs, each lane widened to `--lane-floor` runs, default 20) and
// `stepTable` (per lane and step: median and summed minutes/tokens/agents, and how many runs the step
// changed the outcome in). Without those flags the output is what it was. Rules:
//   closed  run-state.json parses with status 'clean'.
//   recent  "most recent" means most recently STARTED among closed runs: the run id's leading
//           YYYY-MM-DDTHHMMSS read as UTC (`startedAt`; null, so undated and out of the window, when the id
//           has none). A last-event time is not a close time: verify, ci-gate and worktree-reap events keep
//           landing on a run directory after it closed, so ordering by it shifts old runs into the window.
//   lane    driver-events.jsonl present -> `driver`; else `express` when decisions.md holds an
//           'Express lane check: #N proceed' entry no later 'Express lane: escalated #N to /flow' entry
//           cancels (plugin/bin/lib/express/cli.js hasProceed, mirrored: it is not exported); else
//           config.yml's `ceremony-profile`; else `none`.
//
// Exit codes: 0 rendered; 2 no roots given, or a flag value that is not a positive integer.
//
// Seam: run(argv, deps) returns the exit code; deps holds fs, derive (deriveStepYield) and the log/err
// line writers.

const fs = require('fs');
const path = require('path');
const { deriveStepYield, STEP_YIELD_FILE, SCHEMA_VERSION, ownGet, ownSet } = require('../plugin/bin/lib/timing/step-yield');
const { parseEntry } = require('../plugin/bin/lib/log-decision/append');
const { parseFlatLines } = require('../plugin/bin/lib/policy-schema');
const { confirmedCount, startedAtOf } = require('../plugin/bin/lib/review-lens/history');

const VERDICTS = ['confirmed', 'refuted', 'cant-tell', 'unsettled'];
const OUTCOMES = ['confirmed', 'drop', 'digest', 'console', 'none'];

function errText(e) { return (e && e.message) || String(e); }

// roots -> run directory paths (a root's own children and its archive/'s children).
// A root that cannot be read is pushed onto `unreadable` as { root, error } (when given), never
// skipped silently: a mistyped path must not read as an empty archive. A missing archive/ is normal.
function listRunDirs(roots, fsImpl, unreadable = []) {
  const dirs = [];
  for (const root of roots) {
    for (const base of [root, path.join(root, 'archive')]) {
      let ents;
      try { ents = fsImpl.readdirSync(base, { withFileTypes: true }); } catch (e) {
        if (base === root) unreadable.push({ root, error: errText(e) });
        continue;
      }
      for (const e of ents) if (e.isDirectory() && e.name !== 'archive') dirs.push(path.join(base, e.name));
    }
  }
  return dirs;
}

// A run's yield: the file it carries when it parses to an object with a steps array and this build's
// schemaVersion, else derived. A file that is absent (ENOENT) derives silently; one that is present but
// unreadable or not a yield derives too, flagged `fileUnreadable`; a yield of another schemaVersion
// derives too, flagged `fileStale` — its keys may not be the ones this report reads. Both are counted.
function yieldOf(dir, deps) {
  let text;
  try { text = deps.fs.readFileSync(path.join(dir, STEP_YIELD_FILE), 'utf8'); } catch (e) {
    return { y: deps.derive(dir, { now: new Date() }), source: 'derived', fileUnreadable: !(e && e.code === 'ENOENT'), fileStale: false };
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.steps)) {
      if (parsed.schemaVersion === SCHEMA_VERSION) return { y: parsed, source: 'file', fileUnreadable: false, fileStale: false };
      return { y: deps.derive(dir, { now: new Date() }), source: 'derived', fileUnreadable: false, fileStale: true };
    }
  } catch { /* corrupt: derive, flagged */ }
  return { y: deps.derive(dir, { now: new Date() }), source: 'derived', fileUnreadable: true, fileStale: false };
}

function emptyCounters() {
  return { raised: 0, both: 0, one: 0, relabeled: 0, byVerdict: Object.fromEntries(VERDICTS.map((k) => [k, 0])), byOutcome: Object.fromEntries(OUTCOMES.map((k) => [k, 0])) };
}

function addFindings(into, f) {
  into.raised += f.raised || 0; into.both += f.both || 0; into.one += f.one || 0; into.relabeled += f.relabeled || 0;
  const t = f.tiebreak || {};
  for (const k of VERDICTS) into.byVerdict[k] += (t.byVerdict && t.byVerdict[k]) || 0;
  for (const k of OUTCOMES) into.byOutcome[k] += (t.byOutcome && t.byOutcome[k]) || 0;
}

// A recognised log entry counts once under `decisions.<status>`, and a review-marked entry no reader
// matched counts again under `unparsed` — so the status sum is the line total, with no unparsed added.
const decisionLines = (b) => Object.values(b.decisions || {}).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);

function collect(roots, deps, failedDirs = new Set(), yields = null) {
  const rootsUnreadable = [];
  const dirs = listRunDirs(roots, deps.fs, rootsUnreadable);
  const totals = emptyCounters();
  const inReview = emptyCounters();
  const byLens = {};
  const lines = { review: 0, reviewUnparsed: 0, unattributed: 0, unattributedUnparsed: 0 };
  let runsWithFindings = 0;
  let fromFile = 0;
  let failed = 0;
  let fileUnreadable = 0;
  let fileStale = 0;
  for (const dir of dirs) {
    let r;
    try { r = yieldOf(dir, deps); } catch (e) { failed++; failedDirs.add(dir); deps.err(`step-yield-report.js: ${dir}: ${errText(e)}`); continue; }
    if (yields) yields.set(dir, r);
    if (r.source === 'file') fromFile++;
    if (r.fileUnreadable) fileUnreadable++;
    if (r.fileStale) fileStale++;
    const buckets = [...(r.y.steps || []).map((s) => ({ phase: s.phase, b: s })), { phase: null, b: r.y.unattributed || {} }];
    let any = false;
    for (const { phase, b } of buckets) {
      if (phase === 'review') { lines.review += decisionLines(b); lines.reviewUnparsed += (b.unparsed && b.unparsed.count) || 0; }
      if (phase === null) { lines.unattributed += decisionLines(b); lines.unattributedUnparsed += (b.unparsed && b.unparsed.count) || 0; }
      const f = b.findings;
      if (!f) continue;
      any = true;
      addFindings(totals, f);
      if (phase === 'review') addFindings(inReview, f);
      // A lens is text from a log line: read and stored as an own key (`constructor`, `__proto__`).
      for (const [lens, lf] of Object.entries(f.byLens || {})) {
        if (!Object.hasOwn(byLens, lens)) ownSet(byLens, lens, emptyCounters());
        addFindings(ownGet(byLens, lens), lf);
      }
    }
    if (any) runsWithFindings++;
  }
  const share = (n, d) => (d ? n / d : null);
  return {
    roots, rootsUnreadable, runDirsScanned: dirs.length, runsWithReviewFindings: runsWithFindings, runsReadFromFile: fromFile, runsFileUnreadable: fileUnreadable, runsFileStale: fileStale, runsFailed: failed,
    findings: totals, findingsInReviewStep: inReview, byLens,
    reviewLines: {
      total: lines.review, unparsed: lines.reviewUnparsed, unparsedShare: share(lines.reviewUnparsed, lines.review),
      withUnattributed: { total: lines.review + lines.unattributed, unparsed: lines.reviewUnparsed + lines.unattributedUnparsed, unparsedShare: share(lines.reviewUnparsed + lines.unattributedUnparsed, lines.review + lines.unattributed) },
    },
  };
}

// ---- per-run rows, the window and the per-lane step table (#5580) ----

const RUN_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{6}-(spec|record|drive)-/;
const DRIVER_EVENTS_FILE = 'driver-events.jsonl';
const PRODUCT_PHASES = ['build', 'plan', 'tasks'];
const CHECK_STEP = 'Express lane check';
const ESCALATION_STEP = 'Express lane';

function readText(fsImpl, file) {
  try { return fsImpl.readFileSync(file, 'utf8'); } catch { return null; }
}

function readJson(fsImpl, file) {
  const text = readText(fsImpl, file);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (Number.isFinite(v) ? v : 0);

// An express run: a proceed entry for some record that no later escalation of that record cancels.
function expressProceeded(decisionsText) {
  const proceeded = new Map();
  for (const line of String(decisionsText || '').split(/\r?\n/)) {
    const e = parseEntry(line);
    if (!e) continue;
    if (e.location === CHECK_STEP) {
      const m = /^#(\d+) proceed/.exec(e.action);
      if (m) proceeded.set(m[1], true);
    } else if (e.location === ESCALATION_STEP) {
      const m = /^escalated #(\d+) to \/flow/.exec(e.action);
      if (m) proceeded.set(m[1], false);
    }
  }
  return [...proceeded.values()].some(Boolean);
}

function laneOf(dir, fsImpl) {
  if (readText(fsImpl, path.join(dir, DRIVER_EVENTS_FILE)) !== null) return { lane: 'driver', source: 'driver-events' };
  const decisions = readText(fsImpl, path.join(dir, 'decisions.md'));
  if (decisions !== null && expressProceeded(decisions)) return { lane: 'express', source: 'express-check' };
  const config = readText(fsImpl, path.join(dir, 'config.yml'));
  const v = config === null ? null : parseFlatLines(config)['ceremony-profile'];
  const profile = v ? v.replace(/^(["'])(.*)\1$/, '$2') : null;
  return profile ? { lane: profile, source: 'config' } : { lane: 'none', source: 'none' };
}

function closedOf(dir, fsImpl) {
  const state = readJson(fsImpl, path.join(dir, 'run-state.json'));
  return isObject(state) && state.status === 'clean';
}

// driver-events.jsonl -> the driver's own steps, or null when the run has none.
function driverStepsOf(dir, fsImpl) {
  const text = readText(fsImpl, path.join(dir, DRIVER_EVENTS_FILE));
  if (text === null) return null;
  const by = new Map();
  let unparsed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { unparsed++; continue; }
    if (!isObject(ev) || typeof ev.step !== 'string') { unparsed++; continue; }
    if (ev.step === 'final' || ev.step === 'budget') continue;
    if (!by.has(ev.step)) by.set(ev.step, { name: ev.step, count: 0, minutes: 0, tokens: null, failed: 0 });
    const s = by.get(ev.step);
    s.count++;
    s.minutes += num(ev.ms) / 60000;
    if (isObject(ev.usage)) {
      const u = ev.usage;
      s.tokens = (s.tokens || 0) + num(u.input_tokens) + num(u.output_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
    }
    if (ev.status !== 'ok' && ev.status !== 'skip') s.failed++;
  }
  return { steps: [...by.values()], unparsed };
}

const sumCounts = (o) => (isObject(o) ? Object.values(o).reduce((a, n) => a + num(n), 0) : 0);
const TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheCreate'];

function stepRow(s) {
  // A tokens object whose every field is null (step-yield.js writes `tk.input ?? null`) is unknown cost, not 0.
  const t = isObject(s.tokens) && !TOKEN_KEYS.every((k) => s.tokens[k] === null || s.tokens[k] === undefined) ? s.tokens : null;
  const f = isObject(s.findings) ? s.findings : null;
  const commits = isObject(s.commits) ? num(s.commits.commit) : 0;
  const minutes = num(s.minutes);
  return {
    name: s.phase,
    ran: minutes > 0 || sumCounts(s.events) > 0 || sumCounts(s.decisions) > 0,
    minutes,
    tokens: t ? TOKEN_KEYS.reduce((a, k) => a + num(t[k]), 0) : null,
    agents: Number.isFinite(s.agents) ? s.agents : null,
    commits,
    fixCommits: PRODUCT_PHASES.includes(s.phase) ? 0 : commits,
    verifyFail: isObject(s.verify) ? num(s.verify.fail) : 0,
    raised: f ? num(f.raised) : 0,
    confirmed: confirmedCount(f),
  };
}

function runRow(dir, deps) {
  const r = (deps.yields && deps.yields.get(dir)) || yieldOf(dir, deps);
  const { lane, source } = laneOf(dir, deps.fs);
  const driver = lane === 'driver' ? driverStepsOf(dir, deps.fs) : null;
  const runId = path.basename(dir);
  return {
    runId,
    closed: closedOf(dir, deps.fs),
    startedAt: startedAtOf(runId),
    lane, laneSource: source, yieldSource: r.source,
    steps: (r.y.steps || []).map(stepRow),
    driverSteps: driver ? driver.steps : null,
    driverUnparsed: driver ? driver.unparsed : null,
  };
}

// startedAt is an ISO string, so string order is time order; ties break on the run id.
function newestFirst(a, b) {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
  if (a.runId !== b.runId) return a.runId < b.runId ? 1 : -1;
  return 0;
}

// The steps a lane's cost is read from: the driver's own for the driver lane, the yield's otherwise.
const costSteps = (row) => (row.lane === 'driver' ? (row.driverSteps || []) : row.steps);

function selectWindow(rows, { window, laneFloor }) {
  const candidates = rows.filter((r) => r.closed && RUN_NAME_RE.test(r.runId));
  const dated = candidates.filter((r) => r.startedAt !== null).sort(newestFirst);
  const inWindow = dated.slice(0, window);
  const span = (list) => ({ oldest: list.length ? list[list.length - 1].startedAt : null, newest: list.length ? list[0].startedAt : null });
  const lanes = {};
  for (const lane of [...new Set(candidates.map((r) => r.lane))].sort()) {
    const all = dated.filter((r) => r.lane === lane);
    const inside = inWindow.filter((r) => r.lane === lane);
    const used = inside.length < laneFloor ? all.slice(0, laneFloor) : inside;
    const laneCandidates = candidates.filter((r) => r.lane === lane).length;
    lanes[lane] = {
      rows: used, inWindow: inside.length, used: used.length, widened: used.length > inside.length,
      undated: laneCandidates - all.length, archiveTotal: laneCandidates, belowFloor: laneCandidates < laneFloor,
      ...span(used),
      nullCost: used.filter((r) => costSteps(r).every((s) => s.tokens === null)).length,
    };
  }
  return { ...span(inWindow), undated: candidates.length - dated.length, runs: inWindow, lanes };
}

function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const total = (values) => values.reduce((a, n) => a + n, 0);

// A driver step in the shape the table reads: no agents, no commits; a step with a failed event is a failed gate.
const driverAsStep = (s) => ({ name: s.name, ran: s.count > 0, minutes: s.minutes, tokens: s.tokens, agents: null, commits: 0, fixCommits: 0, verifyFail: s.failed > 0 ? 1 : 0, raised: 0, confirmed: 0 });

function stepTable(selection) {
  const table = {};
  for (const [lane, info] of Object.entries(selection.lanes)) {
    const byStep = new Map();
    for (const row of info.rows) {
      for (const s of lane === 'driver' ? (row.driverSteps || []).map(driverAsStep) : row.steps) {
        if (!byStep.has(s.name)) byStep.set(s.name, []);
        byStep.get(s.name).push(s);
      }
    }
    const out = {};
    for (const [name, list] of byStep) {
      const cost = (k) => { const v = list.map((s) => s[k]).filter((x) => x !== null); return { median: median(v), sum: v.length ? total(v) : null, nullRuns: list.length - v.length }; };
      const minutes = list.map((s) => s.minutes);
      out[name] = {
        runs: list.length,
        ranRuns: list.filter((s) => s.ran).length,
        minutes: { median: median(minutes), sum: total(minutes) },
        tokens: cost('tokens'),
        agents: cost('agents'),
        outcome: {
          confirmedRuns: list.filter((s) => s.confirmed > 0).length,
          verifyFailRuns: list.filter((s) => s.verifyFail > 0).length,
          commitRuns: list.filter((s) => s.commits > 0).length,
          fixCommitRuns: list.filter((s) => s.fixCommits > 0).length,
          anyRuns: list.filter((s) => s.confirmed > 0 || s.verifyFail > 0 || s.fixCommits > 0).length,
        },
      };
    }
    table[lane] = out;
  }
  return table;
}

function renderWindow(sel, table) {
  const out = [''];
  for (const [lane, l] of Object.entries(sel.lanes)) {
    out.push(`lane ${lane}: ${l.used} runs (${l.inWindow} in window${l.widened ? ', widened' : ''}${l.belowFloor ? ', below floor' : ''}) ${l.oldest} .. ${l.newest}`);
  }
  const fmt = (n) => (n === null ? 'n/a' : String(Math.round(n * 100) / 100));
  for (const [lane, steps] of Object.entries(table)) {
    for (const [name, t] of Object.entries(steps)) {
      out.push(`step ${lane}/${name}: runs ${t.runs} | ran ${t.ranRuns} | minutes median ${fmt(t.minutes.median)} sum ${fmt(t.minutes.sum)} | tokens median ${fmt(t.tokens.median)} null ${t.tokens.nullRuns} | agents median ${fmt(t.agents.median)} null ${t.agents.nullRuns} | outcome runs: confirmed ${t.outcome.confirmedRuns} verify-fail ${t.outcome.verifyFailRuns} commit ${t.outcome.commitRuns} fix ${t.outcome.fixCommitRuns} any ${t.outcome.anyRuns}`);
    }
  }
  return out.join('\n');
}

const USAGE = 'usage: node tools/step-yield-report.js <pipelines-root>... [--json] [--runs] [--window <N>] [--lane-floor <M>]';
const POSITIVE_INT = /^[1-9]\d*$/;

// argv -> { roots, json, runs, window, laneFloor } or { error }. A value flag takes the next argument.
function parseArgs(argv) {
  const o = { roots: [], json: false, runs: false, window: null, laneFloor: 20 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--runs') o.runs = true;
    else if (a === '--window' || a === '--lane-floor') {
      const v = argv[++i];
      if (typeof v !== 'string' || !POSITIVE_INT.test(v)) return { error: `${a} takes a positive integer, got ${v === undefined ? 'nothing' : `"${v}"`}` };
      if (a === '--window') o.window = Number(v); else o.laneFloor = Number(v);
    } else o.roots.push(a);
  }
  return o;
}

const pct = (n) => (n === null ? 'n/a' : `${(100 * n).toFixed(2)}%`);

function render(s) {
  const f = s.findings;
  const out = [];
  out.push(`run dirs scanned ${s.runDirsScanned} | runs with review findings ${s.runsWithReviewFindings} | yields read from step-yield.json ${s.runsReadFromFile}`);
  out.push(`findings raised ${f.raised} | reported by both reviewers ${f.both} | reported by one reviewer ${f.one} | relabeled ${f.relabeled}`);
  out.push(`  of which in the review step: raised ${s.findingsInReviewStep.raised} | both ${s.findingsInReviewStep.both} | one ${s.findingsInReviewStep.one}`);
  out.push(`tiebreak by verdict: ${VERDICTS.map((k) => `${k} ${f.byVerdict[k]}`).join(' | ')}`);
  out.push(`tiebreak by outcome: ${OUTCOMES.map((k) => `${k} ${f.byOutcome[k]}`).join(' | ')}`);
  out.push('');
  out.push('lens'.padEnd(16) + ['raised', 'both', 'one', 'tb-confirmed', 'tb-refuted'].map((h) => h.padStart(13)).join(''));
  for (const [lens, o] of Object.entries(s.byLens).sort((a, b) => b[1].raised - a[1].raised || a[0].localeCompare(b[0]))) {
    out.push(lens.padEnd(16) + [o.raised, o.both, o.one, o.byVerdict.confirmed, o.byVerdict.refuted].map((n) => String(n).padStart(13)).join(''));
  }
  out.push('');
  const r = s.reviewLines;
  out.push(`review-step decision lines ${r.total} | unparsed ${r.unparsed} | unparsed share ${pct(r.unparsedShare)}`);
  out.push(`with the unattributed bucket added (every line kind there, an upper bound): lines ${r.withUnattributed.total} | unparsed ${r.withUnattributed.unparsed} | share ${pct(r.withUnattributed.unparsedShare)}`);
  if (s.runsFileUnreadable) out.push(`step-yield.json present but unreadable or not a yield (derived instead) ${s.runsFileUnreadable}`);
  if (s.runsFileStale) out.push(`step-yield.json of another schemaVersion than ${SCHEMA_VERSION} (derived instead) ${s.runsFileStale}`);
  if (s.runsFailed) out.push(`runs that failed to derive ${s.runsFailed}`);
  return out.join('\n');
}

function run(argv, deps = {}) {
  const d = { fs, derive: deriveStepYield, log: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`), ...deps };
  const args = parseArgs(argv);
  if (args.error) {
    d.err(`step-yield-report.js: ${args.error}`);
    d.err(USAGE);
    return 2;
  }
  const { roots, json } = args;
  if (!roots.length) {
    d.err(USAGE);
    return 2;
  }
  const failedDirs = new Set();
  const wantRows = args.runs || args.window !== null;
  const yields = wantRows ? new Map() : null;
  const summary = collect(roots, d, failedDirs, yields);
  let windowText = '';
  if (wantRows) {
    // A second pass over the run directories, reusing the yields collect derived (each run derives once);
    // one that already failed to derive in collect is not counted twice.
    const rows = [];
    for (const dir of listRunDirs(roots, d.fs)) {
      if (failedDirs.has(dir)) continue;
      try { rows.push(runRow(dir, { ...d, yields })); } catch (e) { summary.runsFailed++; d.err(`step-yield-report.js: ${dir}: ${errText(e)}`); }
    }
    if (args.runs) summary.runs = rows;
    if (args.window !== null) {
      const selection = selectWindow(rows, { window: args.window, laneFloor: args.laneFloor });
      summary.window = selection;
      summary.stepTable = stepTable(selection);
      windowText = renderWindow(selection, summary.stepTable);
    }
  }
  d.log(json ? JSON.stringify(summary, null, 2) : render(summary) + windowText);
  for (const u of summary.rootsUnreadable) d.err(`step-yield-report: cannot read ${u.root}: ${u.error}`);
  return summary.rootsUnreadable.length ? 2 : 0;
}

module.exports = { run, collect, listRunDirs, RUN_NAME_RE, laneOf, closedOf, startedAtOf, driverStepsOf, runRow, selectWindow, stepTable };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
