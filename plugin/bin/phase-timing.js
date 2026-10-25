#!/usr/bin/env node
// bin/phase-timing.js — render a run's per-phase timing (#1928) and, given
// a transcript, its per-phase tokens (#1929).
//
//   node bin/phase-timing.js --run <dir> [--json] [--markdown]
//        [--transcript <path> ...] [--auto-transcript] [--check-budgets]
//
// Reads {run-dir}/events.jsonl (per-line JSON; a malformed line is skipped,
// a missing file is an empty run), {run-dir}/manifest.yml (optional) and
// {run-dir}/run-state.json (optional: pr.mergedAt; worktree + sessionId for
// --auto-transcript), writes {run-dir}/timing.json, and prints the markdown
// table (--markdown) or the JSON object (--json); with neither it prints the
// path it wrote. Exit 0 in every derivable case — missing events degrade per
// row to `unattributed`; a missing or unreadable transcript degrades to
// blank token columns plus one `tokens: transcript not found (...)` line.
// `--run ""` (present but empty — the canonical skill snippet's unset-
// $PIPELINE_RUN_DIR idiom, matching verify.js's own treatment of it) prints
// "no run directory" to stderr, writes nothing, and returns 0. Exit 2 only
// on a genuinely malformed invocation: a MISSING --run flag, a --run that
// is not a directory, an events.jsonl that exists but cannot be read, or a
// --transcript flag with no value.
//
// --transcript is repeatable (dispatch's two Task calls have two agent
// transcripts; the orchestrator passes both). --auto-transcript is the
// single-session case: it locates {config-dir}/projects/{slug}/{sessionId}
// .jsonl ({config-dir} = $CLAUDE_CONFIG_DIR, default ~/.claude) from
// run-state.json's worktree + sessionId (bin/lib/timing/
// transcript.js), picks the newest candidate, and notes any it ignored.
//
// With a transcript requested, timing.json also gains `dispatches` (#3375):
// the subagent transcripts under each {session}/subagents/ directory,
// aggregated by tier and role, clipped to the run's event window, and printed
// after the phase table; the key is absent without a transcript flag.
//
// --check-budgets (#4029) compares the run's totals with the efficiency
// ceilings for its {run-dir}/config.yml `ceremony-profile` (absent or invalid
// reads as `standard`, with a stderr note) from the checkout's policy.yml, found
// as the parent of the run dir's `.claude-tweaks` ancestor (bin/lib/timing/
// budget.js). It adds a `budget` key to timing.json — { profile, profileSource,
// checks, staged }, or { skipped } with no ancestor — and prints one
// `Budget (...)` line last (no line under --json, whose `budget` key carries
// it). Round trips and procedure KB need a transcript; without one they read
// `unmeasured`. A breach stages an `efficiency-budget-{run-id}` proposal for the
// Review Console's Queue writes section and logs it STAGED (a multi-spec run's
// spec-N dir stages into the parent, keyed on the parent id), unless an open
// record already carries the profile's work fingerprint: then `budget.trackedBy`
// names it and the decision is logged AUTO (a failed gh lookup fails open, with
// a `budget.notes` line). A staging failure
// goes to stderr and `budget.stageError`, and the exit code stays 0. A breach
// left unstaged and any unmeasured metric each also append a SKIP line to the
// run's decisions.md (the Degrade-trace rule). Without the flag the output is
// unchanged, and timing.json differs only by carrying an existing timing.json's
// `budget` key forward untouched.
'use strict';
const fs = require('fs');
const path = require('path');
const { derivePhases, joinTokens, countGuardEvents, aggregateDispatches, TIERS, ROLE_PATTERNS } = require('./lib/timing/derive');
const { locateTranscripts, readUsage, subagentsDirFor, readDispatches } = require('./lib/timing/transcript');
const { readManifest } = require('./lib/flow/manifest');
const { TURN_CLASSES, CEREMONY_CLASSES } = require('./lib/timing/turn-class');
const { checkBudgets } = require('./lib/timing/budget');

const USAGE = 'usage: phase-timing.js --run <dir> [--json] [--markdown] [--transcript <path> ...] [--auto-transcript] [--check-budgets]\n';

function parseArgs(argv) {
  const o = { run: null, json: false, markdown: false, transcripts: [], autoTranscript: false, checkBudgets: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') { o.run = argv[i + 1]; i++; if (o.run === undefined) return null; continue; }
    if (a === '--transcript') { const v = argv[i + 1]; i++; if (v === undefined) return null; o.transcripts.push(v); continue; }
    if (a === '--auto-transcript') { o.autoTranscript = true; continue; }
    if (a === '--check-budgets') { o.checkBudgets = true; continue; }
    if (a === '--json') { o.json = true; continue; }
    if (a === '--markdown') { o.markdown = true; continue; }
    return null;
  }
  if (o.run === null) return null; // flag never supplied — malformed
  return o;
}

function readEvents(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, events: [] };
    return { ok: false, error: err.message };
  }
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* per-row skip, never fatal */ }
  }
  return { ok: true, events };
}

function readJsonOrNull(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function verifyCell(verify) {
  if (!verify.length) return '—';
  const counts = new Map();
  for (const v of verify) counts.set(v.mode || 'unknown', (counts.get(v.mode || 'unknown') || 0) + 1);
  return [...counts].map(([m, n]) => `${m} ×${n}`).join(', ');
}

function kb(bytes) { return (bytes / 1024).toFixed(1); }

// A phase, `tokens.unattributed`, or `tokens.totals` all share the same
// { tokens: {input, output, ...}, procedureBytes, toolRoundTrips } shape —
// this renders the three trailing token columns for any of them.
function tokenCols(bucket) {
  return ` ${bucket.tokens.input}/${bucket.tokens.output} | ${kb(bucket.procedureBytes)} | ${bucket.toolRoundTrips} |`;
}

function extraCols(bucket, blank) {
  return blank ? ' — | — | — |' : tokenCols(bucket);
}

// #2550: a standalone run with no recorded phase events renders every row
// `source: 'unattributed'` — a 12-row table whose only information content
// is "nothing was recorded," padding the report with zero-value noise.
// Collapse to one line instead, using whatever token/round-trip data is
// available (`--auto-transcript` still reads the real transcript even with
// no phase events to attribute it to).
function allPhasesUnattributed(out) {
  return out.phases.length > 0 && out.phases.every((p) => p.source === 'unattributed');
}

function renderCollapsedSummary(tokens, notes, guard) {
  const lines = [];
  for (const n of notes) lines.push(n);
  if (tokens && tokens.totals.rows > 0) {
    lines.push(`no phase events; ${tokens.totals.toolRoundTrips} tool round-trips, ${tokens.totals.tokens.input}/${tokens.totals.tokens.output} tokens`);
  } else {
    lines.push('no phase events; no tool-use data available');
  }
  // A real guard denial is still worth surfacing on a run with no phase
  // events (e.g. a main-checkout run) — only an all-zero count collapses away.
  if (guard && (guard.gateDenial || guard.wdAmbiguous || guard.wdDeny)) {
    lines.push(`Guard denials: ${guard.gateDenial} gate · ${guard.wdAmbiguous} wd-ambiguous · ${guard.wdDeny} wd-deny`);
  }
  return lines.join('\n') + '\n';
}

// [name, count] entries: highest count first, ties by name in code-unit order.
function byCountThenName([nameA, countA], [nameB, countB]) {
  if (countA !== countB) return countB - countA;
  if (nameA < nameB) return -1;
  return nameA > nameB ? 1 : 0;
}

// #4029: the run-wide turn-class and context lines, from a joinTokens totals
// bucket. Per-phase values stay in timing.json.
function renderTurnLines(totals) {
  const k = (n) => (typeof n === 'number' ? `${(n / 1000).toFixed(1)}k` : '—');
  const classes = TURN_CLASSES.map((c) => `${c} ${totals.turnClasses[c]}`).join(' · ');
  // From the integer counts, not the 3dp ceremonyShare float, which can round twice.
  const calls = TURN_CLASSES.reduce((sum, c) => sum + totals.turnClasses[c], 0);
  const ceremony = CEREMONY_CLASSES.reduce((sum, c) => sum + totals.turnClasses[c], 0);
  const share = calls > 0 ? `${Math.round((ceremony * 100) / calls)}%` : '—';
  const models = Object.entries(totals.modelMix).sort(byCountThenName).map(([m, n]) => `${m} ×${n}`).join(', ') || '—';
  const turns = `${totals.context.turns} ${totals.context.turns === 1 ? 'turn' : 'turns'}`;
  return [
    `Turn classes (tool calls): ${classes} — ceremony share ${share}`,
    `Context per turn: p50 ${k(totals.context.p50)} · p90 ${k(totals.context.p90)} tokens over ${turns} · models: ${models} · subagents: ${totals.subagents}`,
  ];
}

// out: derivePhases result; tokens: joinTokens result or null (no transcript
// requested); notes: lines printed before the table.
function renderMarkdown(out, tokens = null, guard = null, notes = []) {
  if (allPhasesUnattributed(out)) return renderCollapsedSummary(tokens, notes, guard);
  const withTokens = tokens !== null;
  const lines = [];
  for (const n of notes) lines.push(n);
  lines.push(withTokens ? '| Phase | Minutes | Verify | Tokens (in/out) | Proc. KB | Tool RTs |' : '| Phase | Minutes | Verify |');
  lines.push(withTokens ? '|---|---|---|---|---|---|' : '|---|---|---|');
  const rows = withTokens ? tokens.phases : out.phases;
  const blank = withTokens && tokens.totals.rows === 0;
  for (const p of rows) {
    const minutes = p.ownMinutes !== p.minutes ? `${p.minutes} (own ${p.ownMinutes})` : String(p.minutes);
    const verify = p.source === 'unattributed' ? 'unattributed' : verifyCell(p.verify);
    const extra = withTokens ? extraCols(p, blank) : '';
    lines.push(`| ${p.phase} | ${minutes} | ${verify} |${extra}`);
  }
  if (withTokens && tokens.unattributed.rows > 0) {
    lines.push(`| unattributed | — | — |${tokenCols(tokens.unattributed)}`);
  }
  if (out.totals.minutes > 0 || out.totals.verifyRuns > 0 || (tokens && tokens.totals.rows > 0)) {
    const verifyTot = `${out.totals.verifyRuns} run(s)${out.totals.verifyModes.length ? ` (${out.totals.verifyModes.join(', ')})` : ''}`;
    const extra = withTokens ? extraCols(tokens.totals, blank) : '';
    lines.push(`| total | ${out.totals.minutes} | ${verifyTot} |${extra}`);
  }
  if (guard) {
    lines.push('', `Guard denials: ${guard.gateDenial} gate · ${guard.wdAmbiguous} wd-ambiguous · ${guard.wdDeny} wd-deny`);
    lines.push('Tokens (in/out) sum the transcript\'s raw input_tokens/output_tokens; cache reads and creation are separate fields in timing.json.');
    if (tokens) lines.push(...renderTurnLines(tokens.totals));
  }
  return lines.join('\n') + '\n';
}

const ROLE_ORDER = [...ROLE_PATTERNS.map((p) => p.role), 'unlabelled'];

function dispatchRow(label, b) {
  const t = b.tokens;
  return `| ${label} | ${b.dispatches} | ${b.agentSeconds} | ${b.elapsedMinutes} | ${t.input}/${t.output} | ${t.cacheRead}/${t.cacheCreate} |`;
}

// One line per item whose transcript or meta was not found: the notFound forms
// readDispatches produces (a meta form — not found or not readable — always
// leaves the description null), then a verbatim fallback.
function dispatchItemLine(d) {
  const code = /^transcript not readable \((.*)\)$/.exec(d.notFound);
  if (code) return `dispatch agent-${d.agentId}: transcript not found (${code[1]})`;
  if (/^meta not /.test(d.notFound)) return `dispatch agent-${d.agentId}: ${d.notFound} (description null)`;
  return `dispatch agent-${d.agentId}: ${d.notFound}`;
}

// dispatches: the timing.json `dispatches` value, or null/undefined (no
// transcript requested) -> ''. Otherwise the text starts with one blank line.
function renderDispatches(dispatches) {
  if (!dispatches) return '';
  if (dispatches.notFound) return `\ndispatches: subagent transcripts not found (${dispatches.notFound})\n`;
  const lines = [''];
  const tiers = TIERS.filter((t) => dispatches.byTier[t]);
  if (tiers.length > 0) {
    const scope = dispatches.scope === 'run-window' ? 'run window' : 'whole session — no run events';
    lines.push(`Dispatches (${scope}; agent-seconds sum spans with overlap kept, elapsed is their union — not comparable to phase minutes):`);
    const cols = '| Dispatches | Agent-seconds | Elapsed (min) | Tokens (in/out) | Cache (read/create) |';
    lines.push(`| Tier ${cols}`, '|---|---|---|---|---|---|');
    for (const t of tiers) {
      const b = dispatches.byTier[t];
      const raw = t === 'unmapped' && b.rawModels && b.rawModels.length ? ` (raw: ${b.rawModels.join(', ')})` : '';
      lines.push(dispatchRow(t + raw, b));
    }
    // A blank line ends the tier table; without it markdown reads the Role header as one more tier row.
    lines.push('', `| Role ${cols}`, '|---|---|---|---|---|---|');
    for (const r of ROLE_ORDER.filter((x) => dispatches.byRole[x])) lines.push(dispatchRow(r, dispatches.byRole[r]));
  }
  for (const d of dispatches.items) if (d.notFound) lines.push(dispatchItemLine(d));
  for (const r of dispatches.notFoundDirs || []) lines.push(`dispatches: subagent transcripts not found (${r})`);
  if (dispatches.excludedOutsideWindow > 0) lines.push(`dispatches: ${dispatches.excludedOutsideWindow} outside the run window excluded`);
  return lines.join('\n') + '\n';
}

// paths: the resolved transcript paths; events: parsed events.jsonl rows. The
// window is the earliest..latest event ts (no event with a ts -> the whole
// session), leaving out worktree-reaped: it fires hours after the session
// ends, so its ts would stretch the window over the idle gap (derive.js's
// endOfRun rule, #1928). Subagents dirs are deduped by fs.realpathSync (path.resolve when
// the dir does not resolve) so a transcript passed twice, or reached through a
// symlinked alias, is not double-counted. -> the timing.json `dispatches` value.
async function collectDispatches(paths, events) {
  const stamps = events.filter((e) => !(e && e.type === 'worktree-reaped')).map((e) => Date.parse(e && e.ts)).filter(Number.isFinite);
  // reduce, not Math.min(...stamps): a spread of a very large array can throw RangeError.
  const window = stamps.length
    ? { start: stamps.reduce((a, b) => Math.min(a, b)), end: stamps.reduce((a, b) => Math.max(a, b)) }
    : null;
  // A symlinked subagents/ leaf keeps its own path, so readDispatches sees the
  // link and refuses it instead of reading wherever it points.
  const canonical = (p) => {
    const dir = path.resolve(subagentsDirFor(p));
    try { return fs.lstatSync(dir).isSymbolicLink() ? dir : fs.realpathSync(dir); } catch { return dir; }
  };
  const dirs = [...new Set(paths.map(canonical))];
  const items = [];
  const reasons = [];
  let excludedOutsideWindow = 0;
  let found = 0;
  for (const dir of dirs) {
    const r = await readDispatches(dir, { window });
    if (r.notFound) { reasons.push(r.notFound); continue; }
    found += 1;
    items.push(...r.items);
    excludedOutsideWindow += r.excludedOutsideWindow;
  }
  if (found === 0) return { notFound: reasons.length ? reasons.join('; ') : 'no transcript resolved' };
  const agg = aggregateDispatches(items);
  const out = { scope: window ? 'run-window' : 'whole-session', items: agg.items, byTier: agg.byTier, byRole: agg.byRole, excludedOutsideWindow };
  // A dir that yielded nothing beside one that did is still named, not dropped.
  if (reasons.length) out.notFoundDirs = reasons;
  return out;
}

// Resolve the transcript list: explicit --transcript paths, plus the
// auto-located one. Returns { paths, notes }.
function resolveTranscripts(o, runState) {
  const paths = [...o.transcripts];
  const notes = [];
  if (o.autoTranscript) {
    const worktree = runState && typeof runState.worktree === 'string' ? runState.worktree : null;
    const sessionId = runState && typeof runState.sessionId === 'string' ? runState.sessionId : null;
    if (!worktree && !sessionId) {
      notes.push('tokens: transcript not found (no worktree or sessionId in run-state.json)');
    } else {
      const found = locateTranscripts({ cwd: worktree, sessionId });
      if (!found.length) notes.push(`tokens: transcript not found (no ${sessionId ? `${sessionId}.jsonl` : '*.jsonl'} under the ${worktree ? 'worktree slug' : 'projects'} directory)`);
      else {
        paths.push(found[0].path);
        if (found.length > 1) notes.push(`tokens: ${found.length - 1} other candidate(s) ignored: ${found.slice(1).map((c) => c.path).join(', ')}`);
      }
    }
  }
  return { paths, notes };
}

async function main(argv) {
  const o = parseArgs(argv);
  if (!o) { process.stderr.write(USAGE); return 2; }
  if (o.run === '') {
    process.stderr.write('timing: no run directory (PIPELINE_RUN_DIR unset)\n');
    return 0;
  }
  const runDir = path.resolve(o.run);
  let stat = null;
  try { stat = fs.statSync(runDir); } catch { /* not a directory, handled below */ }
  if (!stat || !stat.isDirectory()) { process.stderr.write(`phase-timing.js: --run ${o.run} is not a directory\n${USAGE}`); return 2; }
  const events = readEvents(path.join(runDir, 'events.jsonl'));
  if (!events.ok) { process.stderr.write(`phase-timing.js: events.jsonl unreadable (${events.error})\n`); return 2; }
  const runState = readJsonOrNull(path.join(runDir, 'run-state.json'));
  const out = derivePhases({ events: events.events, manifest: readManifest(runDir), runState });

  const wantTokens = o.transcripts.length > 0 || o.autoTranscript;
  const { paths, notes } = wantTokens ? resolveTranscripts(o, runState) : { paths: [], notes: [] };
  const transcripts = [];
  let rows = [];
  for (const p of paths) {
    try {
      const r = await readUsage(p, { worktree: runState && runState.worktree ? runState.worktree : null });
      if (r.length === 0) {
        const note = `transcript had no usage rows (${p})`;
        transcripts.push({ path: p, rows: 0, note });
        notes.push(`tokens: ${note}`);
      } else {
        transcripts.push({ path: p, rows: r.length });
      }
      rows = rows.concat(r);
    } catch (err) {
      const reason = `${err && err.code ? err.code : 'unreadable'}: ${p}`;
      transcripts.push({ path: p, rows: 0, note: `transcript not found (${reason})` });
      notes.push(`tokens: transcript not found (${reason})`);
    }
  }
  const tokens = wantTokens ? joinTokens(out.phases, rows) : null;
  if (tokens) tokens.totals.rows = rows.length;
  const guard = wantTokens ? countGuardEvents(events.events) : null;

  const timing = { runDir, generatedAt: new Date().toISOString(), phases: tokens ? tokens.phases : out.phases, totals: { ...out.totals } };
  if (tokens) {
    timing.unattributed = tokens.unattributed;
    timing.totals.tokens = tokens.totals.tokens;
    timing.totals.procedureBytes = tokens.totals.procedureBytes;
    timing.totals.toolRoundTrips = tokens.totals.toolRoundTrips;
    for (const k of ['turnClasses', 'context', 'modelMix', 'subagents', 'ceremonyShare']) timing.totals[k] = tokens.totals[k];
    timing.totals.guard = guard;
    timing.transcripts = transcripts;
    if (notes.length) timing.notes = notes;
    timing.dispatches = await collectDispatches(paths, events.events);
  }
  // #4029: the efficiency-budget check. A transcript that yielded no rows leaves
  // the transcript-backed totals out, so they read as unmeasured, never as 0 -> ok.
  let budgetLine = null;
  if (o.checkBudgets) {
    const measured = { ...timing.totals };
    if (!tokens || tokens.totals.rows === 0) { delete measured.toolRoundTrips; delete measured.procedureBytes; }
    const checked = checkBudgets({ runDir, totals: measured, unattributed: timing.unattributed });
    timing.budget = checked.budget;
    budgetLine = checked.line;
    for (const line of checked.stderr) process.stderr.write(line + '\n');
  }
  const timingPath = path.join(runDir, 'timing.json');
  // A rewrite without --check-budgets keeps the last budget verdict rather than dropping it.
  if (!o.checkBudgets) {
    const previous = readJsonOrNull(timingPath);
    if (previous && typeof previous === 'object' && Object.hasOwn(previous, 'budget')) timing.budget = previous.budget;
  }
  fs.writeFileSync(timingPath, JSON.stringify(timing, null, 2) + '\n');
  if (o.markdown) process.stdout.write(renderMarkdown(out, tokens, guard, notes) + renderDispatches(timing.dispatches));
  else if (o.json) process.stdout.write(JSON.stringify(timing, null, 2) + '\n');
  else process.stdout.write(`timing: wrote ${timingPath}\n`);
  // Under --json stdout stays one JSON document; the budget rides in its `budget` key.
  if (budgetLine && !o.json) process.stdout.write(budgetLine + '\n');
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((err) => {
    process.stderr.write(`phase-timing.js: ${err && err.message}\n`);
    process.exitCode = 2;
  });
}
module.exports = { main, parseArgs, renderMarkdown, renderDispatches };
