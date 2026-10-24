#!/usr/bin/env node
'use strict';
// tools/efficiency-report.js — cross-run efficiency report over archived pipeline timing.json files (#4029).
//
//   node tools/efficiency-report.js [--archive <dir>] [--json]
//
// Reads {archive}/{run}/timing.json for every run directory (never a nested spec-N/timing.json) and
// prints the median minutes, tool round trips, procedure KB, verify minutes and ceremony share overall,
// per ceremony profile (the run's config.yml `ceremony-profile`, `none` when absent) and per ISO-8601
// week (of the run-id's leading YYYY-MM-DD, else timing.json's generatedAt). A field a file lacks is
// null and left out of that field's median: an older timing.json has no totals.verifyMinutes (summed
// from phases[].verify[].durationMs instead) and no totals.ceremonyShare (null). --json prints the same
// summary as JSON instead of Markdown.
//
// --archive defaults to {main checkout}/.claude-tweaks/pipelines/archive, where the main checkout is
// the dirname of `git rev-parse --path-format=absolute --git-common-dir` — the same archive from any
// worktree. The tool only reads.
//
// Exit codes: 0 rendered; 1 the archive is missing or unreadable (or the default cannot be resolved);
// 2 malformed invocation.
//
// Seam: run({ argv, deps }) returns the exit code; deps holds fs, git(args, {cwd}) (stdout; throws on
// failure), cwd and the log/err line writers.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseFlatLines } = require('../plugin/bin/lib/policy-schema');

const USAGE = 'usage: node tools/efficiency-report.js [--archive <dir>] [--json]';
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

// Reads only {archiveDir}/{entry}/timing.json: a missing file is no run, a malformed one is skipped.
// Throws when the archive directory itself cannot be listed.
function collectRuns(archiveDir, fsImpl) {
  const runs = [];
  let skipped = 0;
  for (const entry of fsImpl.readdirSync(archiveDir).sort()) {
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

function summarize(runs) {
  return {
    overall: group(runs),
    byProfile: groupBy(runs, (r) => r.profile || NO_PROFILE),
    byWeek: groupBy(runs, (r) => r.week || NO_WEEK),
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
  ].join('\n');
}

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--archive') {
      const v = args[++i];
      if (v === undefined || v === '' || v.startsWith('-')) return { error: '--archive needs a value' };
      opts.archive = v;
    } else return { error: `unknown argument ${JSON.stringify(a)}` };
  }
  return { opts };
}

const errText = (e) => String((e && e.message) || e);

function run({ argv, deps: given = {} }) {
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
  let collected;
  try {
    collected = collectRuns(archive, deps.fs);
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

module.exports = { run, collectRuns, median, summarize, isoWeek };

if (require.main === module) {
  process.exitCode = run({ argv: process.argv.slice(2) });
}
