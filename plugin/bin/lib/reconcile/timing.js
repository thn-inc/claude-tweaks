// bin/lib/reconcile/timing.js — per-phase wall time and per-subprocess-family
// cost for one reconcile() pass (#4032). An AsyncLocalStorage store scopes the
// collector to the pass, so the many exec call sites that fire underneath a
// check need no timing parameter threaded through them: they record into
// whichever store is active, and outside a store every recorder is a no-op.
// Measurement only — nothing here changes what a pass does.
'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const path = require('path');
const { performance } = require('perf_hooks');
// Property access at call time (`cp.execFileSync(...)`), never a destructured
// binding: a test's `t.mock.method(cp, 'execFileSync', ...)` mutates the property
// after require and is invisible to a snapshotted function (#381).
const cp = require('child_process');
const { promisify } = require('util');

const storage = new AsyncLocalStorage();

// `current` is the phase subprocess calls are attributed to; it starts at
// 'setup' (everything before the first dispatched check).
function createTimings() {
  return { startedAt: performance.now(), current: 'setup', phases: new Map() };
}

function phaseOf(timings, name) {
  let p = timings.phases.get(name);
  if (!p) {
    p = { ms: 0, subprocesses: new Map() };
    timings.phases.set(name, p);
  }
  return p;
}

function withTimings(timings, fn) {
  return storage.run(timings, fn);
}

function timePhaseSync(name, fn) {
  const t = storage.getStore();
  if (!t) return fn();
  const prev = t.current;
  t.current = name;
  const start = performance.now();
  try {
    return fn();
  } finally {
    phaseOf(t, name).ms += performance.now() - start;
    t.current = prev;
  }
}

async function timePhase(name, fn) {
  const t = storage.getStore();
  if (!t) return fn();
  const prev = t.current;
  t.current = name;
  const start = performance.now();
  try {
    return await fn();
  } finally {
    phaseOf(t, name).ms += performance.now() - start;
    t.current = prev;
  }
}

// gh flags that consume the next token, so it is not mistaken for a positional.
const GH_VALUE_FLAGS = new Set([
  '-X', '--method', '-H', '--header', '-q', '--jq', '-t', '--template',
  '-f', '--raw-field', '-F', '--field', '--input', '--hostname', '--cache', '-R', '--repo',
]);

// First `n` positional (non-flag) tokens, skipping a value-taking flag's value.
function positionals(args, n) {
  const out = [];
  for (let i = 0; i < args.length && out.length < n; i++) {
    const a = String(args[i]);
    if (a.startsWith('-')) {
      if (GH_VALUE_FLAGS.has(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

// Pure. Groups a spawn into a short, stable bucket name: `git <subcommand>`,
// `gh <group> <verb>`, `gh api <resource>`, else the executable's basename.
function commandFamily(file, args) {
  const argv = Array.isArray(args) ? args : [];
  const exe = path.basename(String(file));
  if (exe === 'git') {
    let i = 0;
    while ((argv[i] === '-C' || argv[i] === '-c') && i + 1 < argv.length) i += 2;
    return argv[i] && !String(argv[i]).startsWith('-') ? `git ${argv[i]}` : 'git';
  }
  if (exe === 'gh') {
    if (argv[0] === 'api') {
      const [endpoint] = positionals(argv.slice(1), 1);
      if (!endpoint) return 'gh api';
      const segs = endpoint.replace(/^\//, '').split('?')[0].split('/');
      if (segs[0] === 'repos' && segs.length >= 4) {
        return segs[3] === 'git' && segs[4] ? `gh api git/${segs[4]}` : `gh api ${segs[3]}`;
      }
      return `gh api ${segs[0]}`;
    }
    const words = positionals(argv, 2);
    return words.length ? `gh ${words.join(' ')}` : 'gh';
  }
  return exe;
}

function recordSubprocess(file, args, ms) {
  const t = storage.getStore();
  if (!t) return;
  const family = commandFamily(file, args);
  const buckets = phaseOf(t, t.current).subprocesses;
  const b = buckets.get(family) || { count: 0, ms: 0, maxMs: 0 };
  b.count += 1;
  b.ms += ms;
  if (ms > b.maxMs) b.maxMs = ms;
  buckets.set(family, b);
}

// Drop-in for cp.execFileSync that records its own duration — failures included,
// since a failing call's wall time is just as real. Returns/throws exactly what
// the underlying call does. `windowsHide: true` is forced (repo convention, and
// what windows-hide-spawn-conformance scans for): every caller already sets it.
function execFileSyncTimed(file, args, opts) {
  const start = performance.now();
  try {
    return cp.execFileSync(file, args, { ...opts, windowsHide: true });
  } finally {
    recordSubprocess(file, args, performance.now() - start);
  }
}

// Async twin: promisify(cp.execFile) is resolved fresh per call for the same
// call-time-resolution reason as above (git-exec.js's #872 note).
async function execFileAsyncTimed(file, args, opts) {
  const start = performance.now();
  try {
    return await promisify(cp.execFile)(file, args, { ...opts, windowsHide: true });
  } finally {
    recordSubprocess(file, args, performance.now() - start);
  }
}

const round1 = (n) => Math.round(n * 10) / 10;

// -> { totalMs, phases: { [name]: { ms, subprocessMs, subprocessCount, subprocesses } } }.
// `setup` is the residual: wall time outside every timed phase, so early returns
// (which never reach a timed phase) still report where their time went.
function summarizeTimings(timings) {
  const totalMs = performance.now() - timings.startedAt;
  const timedMs = [...timings.phases].reduce((s, [name, p]) => (name === 'setup' ? s : s + p.ms), 0);
  const phases = {};
  for (const [name, p] of timings.phases) {
    const subprocesses = {};
    let subprocessMs = 0;
    let subprocessCount = 0;
    for (const [family, b] of p.subprocesses) {
      subprocesses[family] = { count: b.count, ms: round1(b.ms), maxMs: round1(b.maxMs) };
      subprocessMs += b.ms;
      subprocessCount += b.count;
    }
    phases[name] = {
      ms: round1(name === 'setup' ? Math.max(0, totalMs - timedMs) : p.ms),
      subprocessMs: round1(subprocessMs),
      subprocessCount,
      subprocesses,
    };
  }
  return { totalMs: round1(totalMs), phases };
}

module.exports = {
  createTimings, phaseOf, withTimings, timePhaseSync, timePhase, recordSubprocess,
  commandFamily, execFileSyncTimed, execFileAsyncTimed, summarizeTimings,
};
