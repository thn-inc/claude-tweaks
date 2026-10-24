// Session-failures lock-wait budget (#841) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// recordFailure serializes writers with a lock directory. These are the timing half of that lock's
// wait/degrade contract: a lock released by another process must be taken before the 2 s timeout,
// and a never-released lock must degrade near a short timeout rather than the 2 s default. Lives
// outside tests/ because a wall-clock assertion flakes under sibling-suite load; the functional half
// (the model is recorded either way) stays in tests/bin-lib/model-profiles/session-failures.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const {
  failurePath, readFailedModels, recordFailure,
} = require('../plugin/bin/lib/model-profiles/session-failures');

function cleanup(sessionId) {
  const p = failurePath(sessionId);
  if (p) { try { fs.unlinkSync(p); } catch { /* already absent */ } }
}

test('a lock already held by another writer is honored — recordFailure waits for it, never races past it', () => {
  // recordFailure's own poll loop blocks this process's main thread
  // synchronously (Atomics.wait), so a same-process setTimeout could never
  // fire while it's running. A real, independent OS process releasing the
  // lock genuinely runs concurrently with that blocked thread, which a
  // same-process timer cannot.
  const { spawn } = require('node:child_process');
  const id = `sf-perf-lock-contend-${process.pid}`;
  cleanup(id);
  const lockDir = `${failurePath(id)}.lock`;
  fs.mkdirSync(lockDir); // simulate a concurrent recordFailure already holding the lock
  const releaser = spawn(
    process.execPath,
    ['-e', `setTimeout(() => { try { require('fs').rmdirSync(${JSON.stringify(lockDir)}); } catch {} }, 30)`],
    { stdio: 'ignore' },
  );
  releaser.on('error', () => {}); // best-effort helper — a spawn failure just makes this test time out, not crash
  try {
    const start = Date.now();
    recordFailure(id, 'opus', { lockTimeoutMs: 2000, lockPollMs: 5 });
    assert.ok(Date.now() - start < 2000, 'must have acquired the lock once released, not fallen through to the 2s timeout');
  } finally {
    releaser.kill();
  }
  assert.deepStrictEqual(readFailedModels(id), new Set(['opus']));
  cleanup(id);
});

test('recordFailure degrades to unlocked (never throws, never hangs past the timeout) when the lock cannot be acquired', () => {
  const id = `sf-perf-lock-timeout-${process.pid}`;
  cleanup(id);
  const lockDir = `${failurePath(id)}.lock`;
  fs.mkdirSync(lockDir); // held forever for this test — never released
  const start = Date.now();
  assert.doesNotThrow(() => recordFailure(id, 'sonnet', { lockTimeoutMs: 50, lockPollMs: 10 }));
  assert.ok(Date.now() - start < 2000, 'must degrade near the short timeout, not the 2s production default');
  // The write still happens (best-effort, unlocked) — the model is recorded
  // even though the lock could never be acquired.
  assert.deepStrictEqual(readFailedModels(id), new Set(['sonnet']));
  fs.rmdirSync(lockDir);
  cleanup(id);
});
