'use strict';
// tools/pipeline-cost-report/funnel.js — the driver admission funnel for the cost report (#5914).
//
// collectFunnel lists the open `ready` + `auto:build` records, asks the driver (`drive.js --check #N`) whether each
// would be admitted, and tallies the refusal reasons. A reason is reduced to a key (reasonKey) so that
// `protected path: a/b.js` and `protected path: c/d.js` are one row; a record counts once per key. A simulation
// answers "how many records would be admitted if these reasons stopped refusing": a record counts when it is
// admitted, or when it was refused for reasons that are all in the set.
//
// `checked` is every listed record. A check that threw, timed out or printed no `{admitted, reasons}` verdict is
// `unreadable`: counted in `checked`, but in neither `admitted` nor `reasons`.
//
// Two window-scoped activity figures sit beside the point-in-time verdicts (#6012), each with its own `unreadable`
// (a run directory, transcript or manifest that could not be read; the scan goes on):
//   driverRuns      — run directories dated in the window that hold `driver-events.jsonl`. `dispatchRouted` are those
//                     whose manifest.json says `lane: "driver"`; everything else is `standalone` — a `-drive-N` run
//                     name, a missing manifest, an unreadable manifest, or any other lane. Standalone is the default
//                     so the flag errs toward speaking. `last` is the latest such run's date.
//   dispatchFirings — main transcripts ({root}/{slug}/*.jsonl, never subagent files) whose first skill is
//                     /claude-tweaks:dispatch and whose first timestamped line falls in the window; `reachedRoute`
//                     counts those that reached the driver route, `byPluginVersion` the plugin version each ran.

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { scanTranscript, transcriptScope } = require('./spend');
const { MANIFEST_FILE } = require('../../plugin/bin/lib/run-manifest/write.js');

const CHECK_CONCURRENCY = 4;
const CHECK_TIMEOUT_MS = 120000;

// Reason heads that embed a value after `': '` (plugin/bin/lib/express/eligibility.js, driver/admission.js,
// driver/steps.js). Every other reason is already a fixed string — `express-driver split: issue number is odd`
// contains `': '` and must stay whole.
const VALUE_HEADS = [
  'protected path',
  'merge-sensitive path',
  'typed command not accepted',
  'size ceiling unreadable',
  'Key File limit unreadable',
  'express-driver value not recognised',
];

function reasonKey(text) {
  const s = String(text);
  for (const head of VALUE_HEADS) {
    if (s === head || s.startsWith(head + ': ')) return head;
  }
  return s;
}

// The verdict is the last non-empty stdout line, parsed as JSON. Anything else is unreadable (null).
function parseVerdict(stdout) {
  if (typeof stdout !== 'string') return null;
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  let v;
  try {
    v = JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
  if (!v || typeof v.admitted !== 'boolean' || !Array.isArray(v.reasons)) return null;
  return { admitted: v.admitted, keys: [...new Set(v.reasons.map(reasonKey))] };
}

// Runs fn over items with at most `limit` in flight; results keep the item order.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STANDALONE_NAME_RE = /-drive-\d+$/;

// runs: listRuns(...).runs; since/until: YYYY-MM-DD, both inclusive.
function collectDriverRuns({ runs, since, until }, { fsImpl = fs } = {}) {
  const res = { total: 0, dispatchRouted: 0, standalone: 0, last: null, unreadable: 0 };
  for (const run of runs) {
    if (!(run.date >= since && run.date <= until)) continue;
    let entries;
    try {
      entries = fsImpl.readdirSync(run.dir);
    } catch {
      res.unreadable += 1;
      continue;
    }
    if (!entries.includes('driver-events.jsonl')) continue;
    res.total += 1;
    if (res.last === null || run.date > res.last) res.last = run.date;
    let routed = false;
    if (!STANDALONE_NAME_RE.test(run.name) && entries.includes(MANIFEST_FILE)) {
      try {
        routed = JSON.parse(fsImpl.readFileSync(path.join(run.dir, MANIFEST_FILE), 'utf8')).lane === 'driver';
      } catch {
        res.unreadable += 1;
      }
    }
    if (routed) res.dispatchRouted += 1;
    else res.standalone += 1;
  }
  return res;
}

async function collectDispatchFirings({ roots, since, until, match = null, root: scopeRoot = null }, { fsImpl = fs, transcriptCache = null } = {}) {
  const startMs = Date.parse(since + 'T00:00:00Z');
  const endMs = Date.parse(until + 'T00:00:00Z') + DAY_MS;
  const res = { total: 0, reachedRoute: 0, byPluginVersion: {}, unreadable: 0 };
  const list = (dir) => {
    try {
      return fsImpl.readdirSync(dir, { withFileTypes: true });
    } catch {
      res.unreadable += 1;
      return [];
    }
  };
  const wanted = transcriptScope({ match, root: scopeRoot });
  for (const root of roots) {
    for (const slugEntry of list(root)) {
      if (!slugEntry.isDirectory()) continue;
      const slug = slugEntry.name;
      const slugDir = path.join(root, slug);
      for (const e of list(slugDir)) {
        if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
        const file = path.join(slugDir, e.name);
        try {
          if (fsImpl.statSync(file).mtimeMs < startMs) continue;
        } catch {
          res.unreadable += 1;
          continue;
        }
        let t = transcriptCache?.get(file);
        if (!t) {
          try {
            const { cwd, firstSkill, firstTs, pluginVersion, reachedRoute } = await scanTranscript(file, { fsImpl });
            t = { cwd, firstSkill, firstTs, pluginVersion, reachedRoute };
          } catch {
            t = { error: true };
          }
          transcriptCache?.set(file, t);
        }
        if (t.error) {
          res.unreadable += 1;
          continue;
        }
        const ts = Date.parse(t.firstTs);
        if (t.firstSkill !== 'dispatch' || !(ts >= startMs && ts < endMs) || !wanted(t.cwd, slug)) continue;
        res.total += 1;
        if (t.reachedRoute === true) res.reachedRoute += 1;
        const version = t.pluginVersion || 'unknown';
        res.byPluginVersion[version] = (res.byPluginVersion[version] || 0) + 1;
      }
    }
  }
  return res;
}

async function collectFunnel(
  { repo, simulate = [], runs = { runs: [] }, roots = [], since, until, match = null, root = null, scopeError = null },
  { gh, check, now, pluginVersion, fsImpl = fs, transcriptCache = null },
) {
  const listed = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'open', '--label', 'ready', '--label', 'auto:build', '--limit', '1000', '--json', 'number']));
  const numbers = listed.map((r) => r.number);

  const verdicts = await mapLimit(numbers, CHECK_CONCURRENCY, async (n) => {
    try {
      return parseVerdict(await check(n));
    } catch {
      return null;
    }
  });

  const readable = verdicts.filter(Boolean);
  const reasons = {};
  for (const v of readable) for (const k of v.keys) reasons[k] = (reasons[k] || 0) + 1;

  const sets = simulate.length > 0 ? simulate.map((s) => [...new Set(s.map(reasonKey))]) : Object.keys(reasons).map((k) => [k]);
  const simulations = sets.map((set) => {
    const inSet = new Set(set);
    const admitted = readable.filter((v) => v.admitted || (v.keys.length > 0 && v.keys.every((k) => inSet.has(k)))).length;
    return { set, unseen: set.filter((k) => !(k in reasons)), admitted };
  });

  const runDate = now().toISOString().slice(0, 10);
  const from = since || runDate;
  const to = until || runDate;
  return {
    checked: verdicts.length,
    admitted: readable.filter((v) => v.admitted).length,
    unreadable: verdicts.length - readable.length,
    reasons,
    simulations,
    runDate,
    pluginVersion,
    driverRuns: runs.error ? { error: runs.error } : collectDriverRuns({ runs: runs.runs, since: from, until: to }, { fsImpl }),
    dispatchFirings: scopeError ? { error: scopeError } : await collectDispatchFirings({ roots, since: from, until: to, match, root }, { fsImpl, transcriptCache }),
  };
}

function readPluginVersion(pluginRoot) {
  return JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
}

// Default gh runner: argv array, never a shell string.
function defaultGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
}

// Default check: resolves drive.js --check's stdout; rejects on a spawn failure, non-zero exit or timeout.
function defaultCheck(pluginRoot, repoRoot) {
  return (n) =>
    new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [path.join(pluginRoot, 'bin', 'drive.js'), '--check', '#' + n],
        { cwd: repoRoot, encoding: 'utf8', timeout: CHECK_TIMEOUT_MS, windowsHide: true },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });
}

module.exports = { reasonKey, collectFunnel, collectDriverRuns, collectDispatchFirings, readPluginVersion, defaultGh, defaultCheck, CHECK_CONCURRENCY };
