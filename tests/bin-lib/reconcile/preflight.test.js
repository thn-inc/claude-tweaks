'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ghHealthCheck, ghHealthCheckAsync } = require('../../../plugin/bin/lib/reconcile/preflight');

test('ghHealthCheck: healthy when the runner returns cleanly', () => {
  const r = ghHealthCheck({ runner: () => '5000\n' });
  assert.deepEqual(r, { ok: true, reason: null });
});

test('ghHealthCheck: gh-absent on ENOENT', () => {
  const r = ghHealthCheck({ runner: () => { const e = new Error('not found'); e.code = 'ENOENT'; throw e; } });
  assert.deepEqual(r, { ok: false, reason: 'gh-absent' });
});

test('ghHealthCheck: github-unreachable on any other failure (timeout, network, non-zero exit)', () => {
  const r = ghHealthCheck({ runner: () => { throw new Error('ETIMEDOUT'); } });
  assert.deepEqual(r, { ok: false, reason: 'github-unreachable' });
});

test('ghHealthCheck: calls `gh api rate_limit`, not a repo-scoped endpoint', () => {
  let seen = null;
  ghHealthCheck({ runner: (args) => { seen = args; return '5000\n'; } });
  assert.ok(seen.includes('rate_limit'), `expected rate_limit in ${JSON.stringify(seen)}`);
});

// #2567: ghHealthCheck now opts in to shared-primitives.js's retryOnTimeout —
// a timeout-shaped first failure (killed + SIGTERM, the shape a real
// execFileSync timeout kill produces — NOT the 'github-unreachable' test
// above, whose synthetic error carries neither and so never engages the
// retry branch at all) is retried once and, on a successful retry, returns
// healthy rather than surfacing 'github-unreachable'.
test('ghHealthCheck: a timeout-shaped first call is retried once and returns healthy on a successful retry', () => {
  let calls = 0;
  const r = ghHealthCheck({
    runner: () => {
      calls += 1;
      if (calls === 1) {
        const e = new Error('timeout');
        e.killed = true;
        e.signal = 'SIGTERM';
        throw e;
      }
      return '5000\n';
    },
  });
  assert.deepEqual(r, { ok: true, reason: null });
  assert.strictEqual(calls, 2, 'runner must be called exactly twice: the original attempt plus one retry');
});

// Async twin (#872) — same contract as ghHealthCheck above, just awaited.
// Mirrors the sync suite's exact scenarios rather than a subset, so the two
// implementations can't silently drift on classification.

test('ghHealthCheckAsync: healthy when the runner returns cleanly', async () => {
  const r = await ghHealthCheckAsync({ runner: async () => '5000\n' });
  assert.deepEqual(r, { ok: true, reason: null });
});

test('ghHealthCheckAsync: gh-absent on ENOENT', async () => {
  const r = await ghHealthCheckAsync({
    runner: async () => { const e = new Error('not found'); e.code = 'ENOENT'; throw e; },
  });
  assert.deepEqual(r, { ok: false, reason: 'gh-absent' });
});

test('ghHealthCheckAsync: github-unreachable on any other failure (timeout, network, non-zero exit)', async () => {
  const r = await ghHealthCheckAsync({ runner: async () => { throw new Error('ETIMEDOUT'); } });
  assert.deepEqual(r, { ok: false, reason: 'github-unreachable' });
});

test('ghHealthCheckAsync: calls `gh api rate_limit`, not a repo-scoped endpoint', async () => {
  let seen = null;
  await ghHealthCheckAsync({ runner: async (args) => { seen = args; return '5000\n'; } });
  assert.ok(seen.includes('rate_limit'), `expected rate_limit in ${JSON.stringify(seen)}`);
});

// #2567 async twin — see the sync version above for the full rationale.
test('ghHealthCheckAsync: a timeout-shaped first call is retried once and returns healthy on a successful retry', async () => {
  let calls = 0;
  const r = await ghHealthCheckAsync({
    runner: async () => {
      calls += 1;
      if (calls === 1) {
        const e = new Error('timeout');
        e.killed = true;
        e.signal = 'SIGTERM';
        throw e;
      }
      return '5000\n';
    },
  });
  assert.deepEqual(r, { ok: true, reason: null });
  assert.strictEqual(calls, 2, 'runner must be called exactly twice: the original attempt plus one retry');
});

test('ghHealthCheckAsync: does not block the event loop (real concurrency, not execFileSync in disguise)', async () => {
  // #1127 then #1404 (pr-state.test.js's own sibling fix, cited there): a
  // fixed wall-clock margin, and later a concurrent-vs-sequential wall-clock
  // RATIO, both flaked under real sibling-session CPU load — any assertion
  // built on *aggregate elapsed time* is exactly what shared-machine
  // scheduler noise perturbs, regardless of where the margin is set (whole-
  // branch review finding, pre-v6.110.0: this test had reintroduced that
  // exact pattern after pr-state.test.js abandoned it). This drops wall-clock
  // comparison for a structural fact instead: each injected runner call
  // increments an active-count while its promise is pending and decrements
  // on settle. Genuine concurrency makes 2+ calls coexist no matter how fast
  // or slow the machine is right now, because it's a count, not a duration;
  // if ghHealthCheckAsync's `await runner(...)` secretly serialized the three
  // Promise.all'd calls, the count could never exceed 1.
  let active = 0;
  let maxActive = 0;
  const sleepyRunner = () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    return new Promise((resolve) => {
      setTimeout(() => {
        active -= 1;
        resolve('5000\n');
      }, 30);
    });
  };

  await Promise.all([
    ghHealthCheckAsync({ runner: sleepyRunner }),
    ghHealthCheckAsync({ runner: sleepyRunner }),
    ghHealthCheckAsync({ runner: sleepyRunner }),
  ]);

  assert.ok(maxActive >= 2, `expected at least 2 concurrent runner invocations (real concurrency); observed max ${maxActive}`);
});
