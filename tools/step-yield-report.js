#!/usr/bin/env node
'use strict';
// tools/step-yield-report.js — review yield over an archive of pipeline run directories (#5556).
//
//   node tools/step-yield-report.js <pipelines-root>... [--json]
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
// Exit codes: 0 rendered; 2 no roots given.
//
// Seam: run(argv, deps) returns the exit code; deps holds fs, derive (deriveStepYield) and the log/err
// line writers.

const fs = require('fs');
const path = require('path');
const { deriveStepYield, STEP_YIELD_FILE, SCHEMA_VERSION } = require('../plugin/bin/lib/timing/step-yield');

const VERDICTS = ['confirmed', 'refuted', 'cant-tell', 'unsettled'];
const OUTCOMES = ['confirmed', 'drop', 'digest', 'console', 'none'];

function errText(e) { return (e && e.message) || String(e); }

// roots -> run directory paths (a root's own children and its archive/'s children).
function listRunDirs(roots, fsImpl) {
  const dirs = [];
  for (const root of roots) {
    for (const base of [root, path.join(root, 'archive')]) {
      let ents;
      try { ents = fsImpl.readdirSync(base, { withFileTypes: true }); } catch { continue; }
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

function collect(roots, deps) {
  const dirs = listRunDirs(roots, deps.fs);
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
    try { r = yieldOf(dir, deps); } catch (e) { failed++; deps.err(`step-yield-report.js: ${dir}: ${errText(e)}`); continue; }
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
      for (const [lens, lf] of Object.entries(f.byLens || {})) addFindings(byLens[lens] || (byLens[lens] = emptyCounters()), lf);
    }
    if (any) runsWithFindings++;
  }
  const share = (n, d) => (d ? n / d : null);
  return {
    roots, runDirsScanned: dirs.length, runsWithReviewFindings: runsWithFindings, runsReadFromFile: fromFile, runsFileUnreadable: fileUnreadable, runsFileStale: fileStale, runsFailed: failed,
    findings: totals, findingsInReviewStep: inReview, byLens,
    reviewLines: {
      total: lines.review, unparsed: lines.reviewUnparsed, unparsedShare: share(lines.reviewUnparsed, lines.review),
      withUnattributed: { total: lines.review + lines.unattributed, unparsed: lines.reviewUnparsed + lines.unattributedUnparsed, unparsedShare: share(lines.reviewUnparsed + lines.unattributedUnparsed, lines.review + lines.unattributed) },
    },
  };
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
  const roots = argv.filter((a) => a !== '--json');
  const json = argv.includes('--json');
  if (!roots.length) {
    d.err('usage: node tools/step-yield-report.js <pipelines-root>... [--json]');
    return 2;
  }
  const summary = collect(roots, d);
  d.log(json ? JSON.stringify(summary, null, 2) : render(summary));
  return 0;
}

module.exports = { run, collect, listRunDirs };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
