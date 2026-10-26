// Git index.lock retry bounded-wait budget (#2346) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// withIndexLockRetry takes an injected sleep, so a runner that always fails on index.lock must exhaust
// its attempts instantly. Under 1 s only catches a real sleep leaking through the injection seam.
// Lives outside tests/ because a wall-clock assertion flakes under sibling-suite load; the functional
// half (attempt count and sleep count) stays in tests/bin-lib/git-retry.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withIndexLockRetry } = require('../plugin/bin/lib/git-retry');

const LOCK_ERR_MSG = "fatal: Unable to create '/repo/.git/index.lock': File exists.";

function fakeSleep(calls) {
  return (ms) => calls.push(ms);
}

// AC3 — bounded, with an injected sleep so the test is instant.
test('withIndexLockRetry: bounded — a runner that always fails on index.lock exits after the configured attempt count with the original error', () => {
  let callCount = 0;
  const sleeps = [];
  const runner = () => {
    callCount += 1;
    const err = new Error('git commit failed');
    err.stderr = LOCK_ERR_MSG;
    throw err;
  };
  const start = Date.now();
  const retrying = withIndexLockRetry(runner, { attempts: 4, sleep: fakeSleep(sleeps) });
  assert.throws(
    () => retrying(['commit', '-m', 'x']),
    (err) => /index\.lock/.test(err.stderr),
  );
  const elapsed = Date.now() - start;
  assert.equal(callCount, 4, 'expected exactly `attempts` calls, no more');
  assert.equal(sleeps.length, 3, 'expected attempts-1 sleeps between attempts');
  assert.ok(elapsed < 1000, `injected sleep must make this instant, took ${elapsed}ms`);
});
