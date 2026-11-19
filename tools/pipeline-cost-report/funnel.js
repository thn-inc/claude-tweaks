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

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

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

async function collectFunnel({ repo, simulate = [] }, { gh, check, now, pluginVersion }) {
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
    return { set, admitted };
  });

  return {
    checked: verdicts.length,
    admitted: readable.filter((v) => v.admitted).length,
    unreadable: verdicts.length - readable.length,
    reasons,
    simulations,
    runDate: now().toISOString().slice(0, 10),
    pluginVersion,
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

module.exports = { reasonKey, collectFunnel, readPluginVersion, defaultGh, defaultCheck, CHECK_CONCURRENCY };
