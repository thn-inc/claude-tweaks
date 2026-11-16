#!/usr/bin/env node
'use strict';
// tools/efficiency-report.js — cross-run efficiency report over archived pipeline timing.json files (#4029).
//
//   node tools/efficiency-report.js [--archive <dir>] [--json] [--recount] [--since <YYYY-MM-DD>]
//
// Reads {archive}/{run}/timing.json for every run directory (never a nested spec-N/timing.json) and
// prints the median minutes, tool round trips, procedure KB, verify minutes and ceremony share overall,
// per ceremony profile (the run's config.yml `ceremony-profile`, `none` when absent) and per ISO-8601
// week (of the run-id's leading YYYY-MM-DD, else timing.json's generatedAt). A field a file lacks is
// null and left out of that field's median: an older timing.json has no totals.verifyMinutes (summed
// from phases[].verify[].durationMs instead) and no totals.ceremonyShare (null). --json prints the same
// summary as JSON instead of Markdown.
//
// It also reports review-phase skill-file reads per file (#4359): the summed phases[].procedureFiles
// of each run's reached review phase, as a median per run (over the runs that carry the data, a
// missing file counted as 0) and a total.
//
// --recount (#4359) instead rebuilds each run's timing from the transcripts its timing.json lists
// (phase-timing.js buildTiming) and prints per-file skill-file reads per run over all phases — median
// and mean over the recounted runs, a missing file counted as 0, and a total — with the counts of runs
// skipped (no listed transcript still exists) and with no reached review phase. --since <YYYY-MM-DD>
// keeps only runs whose directory name's leading date is on or after it, in either mode.
//
// --archive defaults to {main checkout}/.claude-tweaks/pipelines/archive, where the main checkout is
// the dirname of `git rev-parse --path-format=absolute --git-common-dir` — the same archive from any
// worktree. The tool only reads.
//
// Exit codes: 0 rendered; 1 the archive is missing or unreadable (or the default cannot be resolved);
// 2 malformed invocation.
//
// Seam: run({ argv, deps }) resolves to the exit code; deps holds fs, git(args, {cwd}) (stdout; throws
// on failure), cwd, buildTiming (phase-timing.js's) and the log/err line writers.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseFlatLines } = require('../plugin/bin/lib/policy-schema');

const USAGE = 'usage: node tools/efficiency-report.js [--archive <dir>] [--json] [--recount] [--since <YYYY-MM-DD>]';
const NO_PROFILE = 'none';
const NO_WEEK = 'unknown';
const MEDIAN_KEYS = ['minutes', 'roundTrips', 'procedureKb', 'verifyMinutes', 'ceremonyShare'];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function defaultDeps() {
  return {
    fs,
    git: (args, opts = {}) => String(execFileSync('git', args, {
      cwd: opts.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    })),
    cwd: process.cwd(),
    buildTiming: (args) => require('../plugin/bin/phase-timing').buildTiming(args),
    log: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  };
}

// ISO-8601 week of a UTC date as `YYYY-Www`: the week belongs to the year of its Thursday.
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function weekOf(runId, generatedAt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(runId);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    // Reject a date the Date constructor rolled over (2027-02-31).
    if (d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])) return isoWeek(d);
  }
  const t = typeof generatedAt === 'string' ? Date.parse(generatedAt) : NaN;
  return Number.isNaN(t) ? null : isoWeek(new Date(t));
}

// Mean of the two middle values on an even count; null when no value is numeric.
function median(values) {
  const v = values.filter((x) => num(x) !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// totals.verifyMinutes, else the same sum derive.js makes (to one decimal) from the per-phase verify
// events; null when neither is there.
function verifyMinutesOf(timing) {
  const fromTotals = num(timing.totals && timing.totals.verifyMinutes);
  if (fromTotals !== null) return fromTotals;
  if (!Array.isArray(timing.phases)) return null;
  let ms = 0;
  let seen = false;
  for (const p of timing.phases) {
    for (const v of (p && Array.isArray(p.verify) ? p.verify : [])) {
      const d = num(v && v.durationMs);
      if (d !== null) { ms += d; seen = true; }
    }
  }
  return seen ? Math.round(ms / 6000) / 10 : null;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A reached review phase: a phases[] row with phase 'review', a non-null start and a source other
// than 'unattributed' (derive.js emits a span-less review row for a run that never reached review).
const isReachedReview = (p) => Boolean(p) && p.phase === 'review' && p.start != null && p.source !== 'unattributed';

// The per-file procedure reads of every reached review phase, summed. null when no reached review row
// carries a procedureFiles object — an older timing.json, or a run that stopped before review.
function reviewFilesOf(timing) {
  if (!Array.isArray(timing.phases)) return null;
  let files = null;
  for (const p of timing.phases) {
    if (!isReachedReview(p)) continue;
    if (!isPlainObject(p.procedureFiles)) continue;
    files = files || {};
    for (const [key, count] of Object.entries(p.procedureFiles)) {
      const n = num(count);
      if (n !== null) files[key] = (files[key] || 0) + n;
    }
  }
  return files;
}

const isMissing = (e) => e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');

function profileOf(runDir, fsImpl) {
  let raw;
  try {
    raw = fsImpl.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
  } catch (_) {
    return null;
  }
  const v = parseFlatLines(raw)['ceremony-profile'];
  return v ? v.replace(/^(["'])(.*)\1$/, '$2') : null;
}

// --since: a run is kept when its directory name's leading YYYY-MM-DD is on or after `since`; a name
// with no leading date is dropped. No `since` keeps every entry.
function keptEntries(archiveDir, fsImpl, since) {
  const entries = fsImpl.readdirSync(archiveDir).sort();
  if (!since) return entries;
  return entries.filter((e) => {
    const m = /^\d{4}-\d{2}-\d{2}/.exec(e);
    return Boolean(m) && m[0] >= since;
  });
}

// Reads only {archiveDir}/{entry}/timing.json: a missing file is no run, a malformed one is skipped.
// Throws when the archive directory itself cannot be listed.
function collectRuns(archiveDir, fsImpl, since = null) {
  const runs = [];
  let skipped = 0;
  for (const entry of keptEntries(archiveDir, fsImpl, since)) {
    const dir = path.join(archiveDir, entry);
    let text;
    try {
      text = fsImpl.readFileSync(path.join(dir, 'timing.json'), 'utf8');
    } catch (e) {
      if (!isMissing(e)) skipped += 1;
      continue;
    }
    let t = null;
    try {
      t = JSON.parse(text);
    } catch (_) { /* malformed: counted as skipped below */ }
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
      skipped += 1;
      continue;
    }
    const totals = t.totals && typeof t.totals === 'object' ? t.totals : {};
    const bytes = num(totals.procedureBytes);
    runs.push({
      runId: entry,
      week: weekOf(entry, t.generatedAt),
      profile: profileOf(dir, fsImpl),
      minutes: num(totals.minutes),
      roundTrips: num(totals.toolRoundTrips),
      procedureKb: bytes === null ? null : Math.round((bytes / 1024) * 10) / 10,
      verifyMinutes: verifyMinutesOf(t),
      ceremonyShare: num(totals.ceremonyShare),
      reviewFiles: reviewFilesOf(t),
    });
  }
  return { runs, skipped };
}

function group(runs) {
  const medians = {};
  for (const k of MEDIAN_KEYS) {
    const m = median(runs.map((r) => r[k]));
    medians[k] = m === null ? null : Math.round(m * 1000) / 1000;
  }
  return { runs: runs.length, medians };
}

function groupBy(runs, keyOf) {
  const buckets = new Map();
  for (const r of runs) {
    const k = keyOf(r);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  const out = {};
  for (const k of [...buckets.keys()].sort()) out[k] = group(buckets.get(k));
  return out;
}

// Per-file review reads over the runs that carry them: a run missing a key read that file 0 times.
// Files sort by total descending, then by key.
function reviewFileReads(runs) {
  const withData = runs.filter((r) => isPlainObject(r.reviewFiles));
  const keys = new Set(withData.flatMap((r) => Object.keys(r.reviewFiles)));
  const rows = [...keys].map((key) => {
    const counts = withData.map((r) => r.reviewFiles[key] || 0);
    return [key, { median: median(counts), total: counts.reduce((a, b) => a + b, 0) }];
  });
  rows.sort(byTotalThenKey);
  return { runs: withData.length, files: Object.fromEntries(rows) };
}

const byTotalThenKey = (a, b) => b[1].total - a[1].total || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

function readJson(file, fsImpl) {
  try {
    const v = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    return isPlainObject(v) ? v : null;
  } catch (_) {
    return null;
  }
}

function exists(file, fsImpl) {
  try {
    fsImpl.statSync(file);
    return true;
  } catch (_) {
    return false;
  }
}

// --recount (#4359): rebuild each archived run's timing from the transcripts its timing.json lists
// (phase-timing.js buildTiming, which writes nothing) and count its skill-file reads over every
// phases[] bucket — `unattributed` is left out, since a dispatcher's session transcript also holds
// other runs. A run with no `transcripts` list is not a candidate. One whose listed paths all are
// gone, or whose events.jsonl cannot be read, is skipped; one whose recount has no reached review
// phase is noReview. Relative transcript paths resolve against cwd, as phase-timing.js resolves them.
async function recountRuns(archiveDir, { fsImpl, since, cwd, buildTiming }) {
  const perRun = [];
  let skipped = 0;
  let noReview = 0;
  for (const entry of keptEntries(archiveDir, fsImpl, since)) {
    const dir = path.join(archiveDir, entry);
    const t = readJson(path.join(dir, 'timing.json'), fsImpl);
    if (!t || !Array.isArray(t.transcripts) || t.transcripts.length === 0) continue;
    const paths = t.transcripts
      .map((x) => (x && typeof x.path === 'string' && x.path ? x.path : null))
      .filter((p) => p !== null && exists(path.resolve(cwd, p), fsImpl));
    if (!paths.length) { skipped += 1; continue; }
    const state = readJson(path.join(dir, 'run-state.json'), fsImpl);
    const worktree = state && typeof state.worktree === 'string' && state.worktree ? state.worktree : null;
    let timing;
    try {
      timing = await buildTiming({ runDir: dir, paths, cwd, worktree });
    } catch (_) {
      skipped += 1;
      continue;
    }
    const phases = Array.isArray(timing.phases) ? timing.phases : [];
    if (!phases.some(isReachedReview)) { noReview += 1; continue; }
    const reads = {};
    for (const p of phases) {
      for (const [key, count] of Object.entries(isPlainObject(p.procedureFiles) ? p.procedureFiles : {})) {
        const n = num(count);
        if (n !== null) reads[key] = (reads[key] || 0) + n;
      }
    }
    perRun.push({ run: entry, reads });
  }
  const keys = new Set(perRun.flatMap((r) => Object.keys(r.reads)));
  const rows = [...keys].map((key) => {
    const counts = perRun.map((r) => r.reads[key] || 0);
    const total = counts.reduce((a, b) => a + b, 0);
    return [key, { median: median(counts), mean: Math.round((total / counts.length) * 10) / 10, total }];
  });
  rows.sort(byTotalThenKey);
  return { runs: perRun.length, skipped, noReview, files: Object.fromEntries(rows), perRun };
}

const RECOUNT_TOP = 20;

function renderRecount(recount) {
  const lines = [
    '## Recounted skill-file reads per run (all phases)',
    '',
    `runs recounted: ${recount.runs} (skipped: ${recount.skipped}, no review: ${recount.noReview})`,
    '',
    '| File | Median reads/run | Mean reads/run | Total reads |',
    '|---|---|---|---|',
  ];
  for (const [key, f] of Object.entries(recount.files).slice(0, RECOUNT_TOP)) lines.push(`| ${key} | ${fmt(f.median)} | ${fmt(f.mean)} | ${f.total} |`);
  return lines.join('\n');
}

function summarize(runs) {
  return {
    overall: group(runs),
    byProfile: groupBy(runs, (r) => r.profile || NO_PROFILE),
    byWeek: groupBy(runs, (r) => r.week || NO_WEEK),
    reviewFileReads: reviewFileReads(runs),
  };
}

const fmt = (v) => (v === null ? '—' : String(Math.round(v * 10) / 10));
const fmtShare = (v) => (v === null ? '—' : `${Math.round(v * 100)}%`);

function table(label, groups) {
  const lines = [`| ${label} | Runs | Minutes | Round trips | Proc. KB | Verify min | Ceremony share |`, '|---|---|---|---|---|---|---|'];
  for (const [key, g] of Object.entries(groups)) {
    const m = g.medians;
    lines.push(`| ${key} | ${g.runs} | ${fmt(m.minutes)} | ${fmt(m.roundTrips)} | ${fmt(m.procedureKb)} | ${fmt(m.verifyMinutes)} | ${fmtShare(m.ceremonyShare)} |`);
  }
  return lines.join('\n');
}

function reviewFilesTable(reads) {
  if (!reads.runs) return 'no run carries per-file read data';
  const lines = ['| File | Median reads/run | Total reads |', '|---|---|---|'];
  for (const [key, f] of Object.entries(reads.files)) lines.push(`| ${key} | ${fmt(f.median)} | ${f.total} |`);
  return lines.join('\n');
}

function renderMarkdown(summary, roundTripRuns, skipped) {
  const o = summary.overall;
  const m = o.medians;
  return [
    `runs: ${o.runs} (${roundTripRuns} with round-trip data, ${skipped} skipped) · median minutes ${fmt(m.minutes)} · median round trips ${fmt(m.roundTrips)} · median procedure KB ${fmt(m.procedureKb)} · median verify minutes ${fmt(m.verifyMinutes)}`,
    '',
    '## By profile',
    '',
    table('Profile', summary.byProfile),
    '',
    '## By week',
    '',
    table('Week', summary.byWeek),
    '',
    '## Review-phase skill-file reads',
    '',
    `runs with per-file data: ${summary.reviewFileReads.runs}`,
    '',
    reviewFilesTable(summary.reviewFileReads),
  ].join('\n');
}

// A real calendar date written YYYY-MM-DD (2027-02-31 is not one).
function isDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof v === 'string' ? v : '');
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opts.json = true;
    else if (a === '--recount') opts.recount = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--since') {
      const v = args[++i];
      if (!isDate(v)) return { error: '--since needs a YYYY-MM-DD date' };
      opts.since = v;
    }
    else if (a === '--archive') {
      const v = args[++i];
      if (v === undefined || v === '' || v.startsWith('-')) return { error: '--archive needs a value' };
      opts.archive = v;
    } else return { error: `unknown argument ${JSON.stringify(a)}` };
  }
  return { opts };
}

const errText = (e) => String((e && e.message) || e);

async function run({ argv, deps: given = {} }) {
  const deps = { ...defaultDeps(), ...given };
  const parsed = parseArgs(argv);
  if (parsed.error) {
    deps.err(`efficiency-report.js: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { opts } = parsed;
  if (opts.help) {
    deps.log(USAGE);
    return 0;
  }
  let archive = opts.archive ? path.resolve(deps.cwd, opts.archive) : null;
  if (!archive) {
    try {
      const commonDir = deps.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: deps.cwd }).trim();
      if (!commonDir) throw new Error('empty output');
      archive = path.join(path.dirname(commonDir), '.claude-tweaks', 'pipelines', 'archive');
    } catch (e) {
      deps.err(`efficiency-report.js: cannot resolve the default archive (${errText(e)}); pass --archive <dir>`);
      return 1;
    }
  }
  if (opts.recount) {
    let recount;
    try {
      recount = await recountRuns(archive, { fsImpl: deps.fs, since: opts.since || null, cwd: deps.cwd, buildTiming: deps.buildTiming });
    } catch (e) {
      deps.err(`efficiency-report.js: cannot read the archive ${archive}: ${errText(e)}`);
      return 1;
    }
    if (opts.json) deps.log(JSON.stringify({ archive, recount }, null, 2));
    else deps.log(recount.runs ? renderRecount(recount) : 'no archived run has a readable transcript');
    return 0;
  }
  let collected;
  try {
    collected = collectRuns(archive, deps.fs, opts.since || null);
  } catch (e) {
    deps.err(`efficiency-report.js: cannot read the archive ${archive}: ${errText(e)}`);
    return 1;
  }
  const { runs, skipped } = collected;
  const summary = summarize(runs);
  const roundTripRuns = runs.filter((r) => r.roundTrips !== null).length;
  deps.log(opts.json
    ? JSON.stringify({ archive, skipped, roundTripRuns, ...summary }, null, 2)
    : renderMarkdown(summary, roundTripRuns, skipped));
  return 0;
}

module.exports = { run, collectRuns, recountRuns, median, summarize, isoWeek, reviewFilesOf };

if (require.main === module) {
  run({ argv: process.argv.slice(2) }).then((code) => { process.exitCode = code; }).catch((e) => {
    process.stderr.write(`efficiency-report.js: ${errText(e)}\n`);
    process.exitCode = 1;
  });
}
