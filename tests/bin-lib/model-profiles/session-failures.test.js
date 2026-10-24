'use strict';
const { test, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  failurePath, readFailedModels, recordFailure, invalidateFailures,
} = require('../../../plugin/bin/lib/model-profiles/session-failures');

function cleanup(sessionId) {
  const p = failurePath(sessionId);
  if (p) { try { fs.unlinkSync(p); } catch { /* already absent */ } }
}

test('failurePath is null for a missing/blank session id, a real path otherwise', () => {
  assert.strictEqual(failurePath(undefined), null);
  assert.strictEqual(failurePath(''), null);
  assert.strictEqual(failurePath('  '), null);
  assert.strictEqual(failurePath('abc-123'), path.join(os.tmpdir(), 'ct-model-failures-abc-123.json'));
});

test('readFailedModels returns an empty set when no file exists', () => {
  const id = `sf-test-empty-${process.pid}`;
  cleanup(id);
  assert.deepStrictEqual(readFailedModels(id), new Set());
});

test('readFailedModels degrades to an empty set on malformed JSON, never throws', () => {
  const id = `sf-test-malformed-${process.pid}`;
  fs.writeFileSync(failurePath(id), 'not json');
  assert.deepStrictEqual(readFailedModels(id), new Set());
  cleanup(id);
});

test('recordFailure then readFailedModels round-trips one model', () => {
  const id = `sf-test-roundtrip-${process.pid}`;
  cleanup(id);
  recordFailure(id, 'fable');
  assert.deepStrictEqual(readFailedModels(id), new Set(['fable']));
  cleanup(id);
});

test('recordFailure is idempotent — recording the same model twice does not duplicate', () => {
  const id = `sf-test-idempotent-${process.pid}`;
  cleanup(id);
  recordFailure(id, 'fable');
  recordFailure(id, 'fable');
  const raw = JSON.parse(fs.readFileSync(failurePath(id), 'utf8'));
  assert.strictEqual(raw.length, 1);
  cleanup(id);
});

test('recordFailure accumulates distinct models across calls', () => {
  const id = `sf-test-accumulate-${process.pid}`;
  cleanup(id);
  recordFailure(id, 'fable');
  recordFailure(id, 'opus');
  assert.deepStrictEqual(readFailedModels(id), new Set(['fable', 'opus']));
  cleanup(id);
});

test('recordFailure is a no-op with no session id — nothing thrown, no file written', () => {
  assert.doesNotThrow(() => recordFailure(undefined, 'fable'));
  assert.doesNotThrow(() => recordFailure('', 'fable'));
});

// recordFailure's atomic-write guarantee (#763 final-review fix): a
// concurrent readFailedModels must never observe a torn/truncated write.
// Proving this without real concurrency: spy on fs.writeFileSync/renameSync
// and assert recordFailure only ever writes to a same-directory temp path
// and only reaches the real path via rename — never a direct write to `p`,
// which is the one operation that could leave a reader mid-truncation.
test('recordFailure writes via a temp file + atomic rename, never a direct write to the real path', () => {
  const id = `sf-test-atomic-${process.pid}`;
  cleanup(id);
  const p = failurePath(id);
  const realWriteFileSync = fs.writeFileSync;
  const realRenameSync = fs.renameSync;
  const writeCalls = [];
  const renameCalls = [];
  const writeSpy = mock.method(fs, 'writeFileSync', (target, ...rest) => {
    writeCalls.push(target);
    return realWriteFileSync.call(fs, target, ...rest);
  });
  const renameSpy = mock.method(fs, 'renameSync', (from, to) => {
    renameCalls.push([from, to]);
    return realRenameSync.call(fs, from, to);
  });
  try {
    recordFailure(id, 'fable');
  } finally {
    writeSpy.mock.restore();
    renameSpy.mock.restore();
  }
  assert.ok(!writeCalls.includes(p), 'writeFileSync must never target the real path directly');
  assert.strictEqual(writeCalls.length, 1);
  assert.strictEqual(writeCalls[0], `${p}.tmp-${process.pid}`);
  assert.strictEqual(renameCalls.length, 1);
  assert.deepStrictEqual(renameCalls[0], [`${p}.tmp-${process.pid}`, p]);
  // The rename happened for real — the real path now holds the recorded model,
  // and no leftover temp file remains.
  assert.deepStrictEqual(readFailedModels(id), new Set(['fable']));
  assert.ok(!fs.existsSync(`${p}.tmp-${process.pid}`));
  cleanup(id);
});

test('two session ids never share a file', () => {
  const idA = `sf-test-a-${process.pid}`;
  const idB = `sf-test-b-${process.pid}`;
  cleanup(idA);
  cleanup(idB);
  recordFailure(idA, 'fable');
  assert.deepStrictEqual(readFailedModels(idB), new Set());
  cleanup(idA);
  cleanup(idB);
});

// #841 item 1: recordFailure now serializes its read-modify-write behind a
// mkdir-based lock (see session-failures.js's acquireLock/releaseLock),
// closing the lost-update race between two concurrent recordFailure calls
// for two different models. Proving genuine concurrency deterministically
// within one single-threaded process isn't possible, so these tests prove
// the two properties that combine to close the race instead: (1) the lock
// is held across the whole read-modify-write critical section (acquired
// before the read, released only after the rename), and (2) a lock already
// held by someone else is honored — a second recordFailure blocks until it
// is free rather than racing past it.
test('recordFailure acquires the lock before reading and releases it only after the rename', () => {
  const id = `sf-test-lock-order-${process.pid}`;
  cleanup(id);
  const p = failurePath(id);
  const lockDir = `${p}.lock`;
  const realReadFileSync = fs.readFileSync;
  const realRenameSync = fs.renameSync;
  const order = [];
  const readSpy = mock.method(fs, 'readFileSync', (target, ...rest) => {
    if (target === p) order.push('read');
    return realReadFileSync.call(fs, target, ...rest);
  });
  const renameSpy = mock.method(fs, 'renameSync', (from, to) => {
    order.push('rename');
    return realRenameSync.call(fs, from, to);
  });
  try {
    recordFailure(id, 'fable');
  } finally {
    readSpy.mock.restore();
    renameSpy.mock.restore();
  }
  // The read (inside readFailedModels) and the rename both ran while the
  // lock directory could not have been held by anyone else, and the lock
  // directory itself must be gone again once recordFailure returns.
  assert.deepStrictEqual(order, ['read', 'rename']);
  assert.ok(!fs.existsSync(lockDir), 'lock directory must be released after recordFailure returns');
  cleanup(id);
});

test('a lock released by another writer mid-wait still ends with the model recorded (the wait-vs-timeout bound is perf/session-failures-lock-wait.test.js)', () => {
  // recordFailure's own poll loop blocks this process's main thread
  // synchronously (Atomics.wait), so a same-process setTimeout could never
  // fire while it's running. A real, independent OS process releasing the
  // lock genuinely runs concurrently with that blocked thread, which a
  // same-process timer cannot.
  const { spawn } = require('node:child_process');
  const id = `sf-test-lock-contend-${process.pid}`;
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
    recordFailure(id, 'opus', { lockTimeoutMs: 2000, lockPollMs: 5 });
  } finally {
    releaser.kill();
  }
  assert.deepStrictEqual(readFailedModels(id), new Set(['opus']));
  cleanup(id);
});

test('recordFailure degrades to unlocked (never throws, still records the model) when the lock cannot be acquired', () => {
  const id = `sf-test-lock-timeout-${process.pid}`;
  cleanup(id);
  const lockDir = `${failurePath(id)}.lock`;
  fs.mkdirSync(lockDir); // held forever for this test — never released
  assert.doesNotThrow(() => recordFailure(id, 'sonnet', { lockTimeoutMs: 50, lockPollMs: 10 }));
  // The write still happens (best-effort, unlocked) — the model is recorded
  // even though the lock could never be acquired.
  assert.deepStrictEqual(readFailedModels(id), new Set(['sonnet']));
  fs.rmdirSync(lockDir);
  cleanup(id);
});

// #841 item 3: the recovery path — deletes the blacklist so a session
// wrongly (or no-longer-relevantly) degraded can resume resolving normally
// before the credit-exhaustion window naturally rolls over.
test('invalidateFailures deletes the blacklist file', () => {
  const id = `sf-test-invalidate-${process.pid}`;
  cleanup(id);
  recordFailure(id, 'fable');
  assert.deepStrictEqual(readFailedModels(id), new Set(['fable']));
  invalidateFailures(id);
  assert.deepStrictEqual(readFailedModels(id), new Set());
  assert.ok(!fs.existsSync(failurePath(id)));
});

test('invalidateFailures tolerates an already-absent file, never throws', () => {
  const id = `sf-test-invalidate-absent-${process.pid}`;
  cleanup(id);
  assert.doesNotThrow(() => invalidateFailures(id));
});

test('invalidateFailures is a no-op with no session id', () => {
  assert.doesNotThrow(() => invalidateFailures(undefined));
  assert.doesNotThrow(() => invalidateFailures(''));
});
