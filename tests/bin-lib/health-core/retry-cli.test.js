'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeRetryQueueCommands } = require('../../../plugin/bin/lib/health-core/retry-cli');

function fakeDurableState(initial) {
  let state = { retryQueue: [], ...initial };
  return {
    readDurableState: () => state,
    writeDurableState: (root, mutatorFn) => {
      state = mutatorFn(state);
      return { ok: true };
    },
  };
}

// Simulates writeDurableState's own CAS-retry loop (durable-state.js's
// writeState) re-invoking the mutator fresh on every attempt before the
// write finally succeeds — see durable-state.test.js's "retries on a
// rejected ref update" test for the real behavior this stands in for. Only
// the LAST invocation's returned state is ever actually persisted.
function fakeDurableStateWithRetries(initial, invocationsBeforeSuccess) {
  let state = { retryQueue: [], ...initial };
  return {
    readDurableState: () => state,
    writeDurableState: (root, mutatorFn) => {
      let next;
      for (let i = 0; i < invocationsBeforeSuccess; i++) {
        next = mutatorFn(state);
      }
      state = next;
      return { ok: true };
    },
  };
}

// Simulates writeDurableState exhausting all CAS attempts and giving up —
// the mutator still runs once (computing an escalated list against
// unpersisted state), but the write itself never lands.
function fakeDurableStateThatFailsToPersist(initial) {
  let state = { retryQueue: [], ...initial };
  return {
    readDurableState: () => state,
    writeDurableState: (root, mutatorFn) => {
      mutatorFn(state); // runs (and would compute `escalated`), but result is discarded
      return { ok: false, error: 'exhausted 3 CAS attempts' };
    },
  };
}

function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return out;
}

test('drain prints the payload of every queued entry', () => {
  const ds = fakeDurableState({
    retryQueue: [
      { fingerprint: 'a', payload: { title: 'A' }, firstFailedAt: 'x', attempts: 1, lastError: null },
      { fingerprint: 'b', payload: { title: 'B' }, firstFailedAt: 'x', attempts: 1, lastError: null },
    ],
  });
  const { drain } = makeRetryQueueCommands(ds);
  const out = captureStdout(() => drain({ root: '/repo' }));
  assert.deepStrictEqual(JSON.parse(out), [{ title: 'A' }, { title: 'B' }]);
});

test('drain prints [] when the queue is empty', () => {
  const ds = fakeDurableState({ retryQueue: [] });
  const { drain } = makeRetryQueueCommands(ds);
  const out = captureStdout(() => drain({ root: '/repo' }));
  assert.deepStrictEqual(JSON.parse(out), []);
});

test('update dequeues successes and enqueues failures, printing entries that just crossed the escalation threshold', () => {
  const ds = fakeDurableState({
    retryQueue: [
      { fingerprint: 'stuck', payload: { title: 'Stuck' }, firstFailedAt: 'x', attempts: 2, lastError: 'timeout' },
      // 'fresh' must already be a queued entry (not a brand-new fingerprint)
      // so the ok:true result below has a real, pre-existing queue entry to
      // dequeue — otherwise dequeueRetry running or not running on it is
      // unobservable (there's nothing there to remove either way).
      { fingerprint: 'fresh', payload: { title: 'Fresh' }, firstFailedAt: 'x', attempts: 1, lastError: 'timeout' },
    ],
  });
  const { update } = makeRetryQueueCommands(ds);
  const resultsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'retry-cli-')), 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify([
    { fingerprint: 'stuck', payload: { title: 'Stuck' }, ok: false, error: 'still failing' },
    { fingerprint: 'fresh', payload: { title: 'Fresh' }, ok: true },
  ]));
  const out = captureStdout(() => update({ root: '/repo', _: ['update', resultsPath] }));
  const escalated = JSON.parse(out);
  assert.strictEqual(escalated.length, 1);
  assert.strictEqual(escalated[0].fingerprint, 'stuck');
  assert.strictEqual(escalated[0].attempts, 3);
  // Prove dequeueRetry actually removed the now-successful 'fresh' entry from
  // the persisted queue, not just that it's absent from the (failures-only)
  // escalated output.
  const persisted = ds.readDurableState().retryQueue;
  assert.ok(
    !persisted.some((e) => e.fingerprint === 'fresh'),
    `expected 'fresh' to be dequeued from the persisted retryQueue on success; got ${JSON.stringify(persisted)}`,
  );
});

test('update reports each escalated fingerprint exactly once even when the mutator is re-invoked multiple times before the write succeeds', () => {
  const ds = fakeDurableStateWithRetries(
    {
      retryQueue: [
        { fingerprint: 'stuck', payload: { title: 'Stuck' }, firstFailedAt: 'x', attempts: 2, lastError: 'timeout' },
      ],
    },
    3, // simulate 3 CAS attempts (2 rejected, 1 finally accepted) before success
  );
  const { update } = makeRetryQueueCommands(ds);
  const resultsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'retry-cli-')), 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify([
    { fingerprint: 'stuck', payload: { title: 'Stuck' }, ok: false, error: 'still failing' },
  ]));
  const out = captureStdout(() => update({ root: '/repo', _: ['update', resultsPath] }));
  const escalated = JSON.parse(out);
  assert.strictEqual(escalated.length, 1, 'must report the fingerprint exactly once, not once per retried mutator invocation');
  assert.strictEqual(escalated[0].fingerprint, 'stuck');
});

test('update prints [] AND returns exit code 1, leaving process.exitCode untouched (not the computed-but-unpersisted escalation, and never a silent exit 0) when health-state persistence fails after retries', () => {
  const ds = fakeDurableStateThatFailsToPersist({
    retryQueue: [
      { fingerprint: 'stuck', payload: { title: 'Stuck' }, firstFailedAt: 'x', attempts: 2, lastError: 'timeout' },
    ],
  });
  const { update } = makeRetryQueueCommands(ds);
  const resultsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'retry-cli-')), 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify([
    { fingerprint: 'stuck', payload: { title: 'Stuck' }, ok: false, error: 'still failing' },
  ]));
  // update() returns the code (the CLI wires it onto process.exitCode); it
  // must never set process.exitCode itself.
  const exitCodeBefore = process.exitCode;
  let code;
  const out = captureStdout(() => { code = update({ root: '/repo', _: ['update', resultsPath] }); });
  assert.strictEqual(code, 1, 'a genuinely failed durable write must return a non-zero code, or a calling shell/Routine checking $? sees success and never surfaces the failure');
  assert.strictEqual(process.exitCode, exitCodeBefore, 'update must not change process.exitCode');
  assert.deepStrictEqual(JSON.parse(out), [], 'must not report an escalation that was never actually persisted to retry-queue.json');
});

test('drain returns 0 and writes through an injected io', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-cli-'));
  let out = '';
  let err = '';
  const seen = [];
  const cmds = makeRetryQueueCommands({
    readDurableState: (r) => { seen.push(r); return { retryQueue: [{ payload: { a: 1 } }] }; },
    writeDurableState: () => ({ ok: true }),
    io: { stdout: (t) => { out += t; }, stderr: (t) => { err += t; }, cwd: () => root },
  });
  const code = cmds.drain({ _: [] });
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(JSON.parse(out), [{ a: 1 }]);
  assert.strictEqual(err, '');
  assert.deepStrictEqual(seen, [root]);
});

test('update returns 0 on success and 2 on a missing results path, writing through an injected io', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-cli-'));
  let out = '';
  let err = '';
  const cmds = makeRetryQueueCommands({
    readDurableState: () => ({ retryQueue: [] }),
    writeDurableState: (r, mutator) => { mutator({ retryQueue: [] }); return { ok: true }; },
    io: { stdout: (t) => { out += t; }, stderr: (t) => { err += t; }, cwd: () => root },
  });
  assert.strictEqual(cmds.update({ _: ['update'] }), 2);
  assert.match(err, /^usage: <cli>\.js retry-queue update/);
  const resultsPath = path.join(root, 'results.json');
  fs.writeFileSync(resultsPath, '[]');
  assert.strictEqual(cmds.update({ _: ['update', resultsPath] }), 0);
  assert.deepStrictEqual(JSON.parse(out), []);
});

test('update skips a malformed (e.g. null) results entry instead of crashing, and still processes well-formed siblings in the same batch', () => {
  const ds = fakeDurableState({ retryQueue: [] });
  const { update } = makeRetryQueueCommands(ds);
  const resultsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'retry-cli-')), 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify([
    null,
    { fingerprint: 'good', payload: { title: 'Good' }, ok: false, error: 'timeout' },
  ]));
  let stderrOut = '';
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { stderrOut += chunk; return true; };
  let out;
  try {
    out = captureStdout(() => update({ root: '/repo', _: ['update', resultsPath] }));
  } finally {
    process.stderr.write = originalStderrWrite;
  }
  assert.ok(stderrOut.includes('skipping malformed result entry'), `expected a skip warning in stderr: ${stderrOut}`);
  assert.deepStrictEqual(JSON.parse(out), [], 'the well-formed entry alone must not cross the escalation threshold');
  // Prove the batch wasn't silently discarded wholesale (the pre-fix bug): the
  // well-formed 'good' entry, which comes AFTER the malformed null in the
  // array, must still have been enqueued into the persisted retryQueue.
  const persisted = ds.readDurableState().retryQueue;
  assert.ok(
    persisted.some((e) => e.fingerprint === 'good'),
    `expected 'good' fingerprint to be enqueued despite the malformed sibling entry; got ${JSON.stringify(persisted)}`,
  );
});

test('update reports an escalated fingerprint only on the firing it first crosses the threshold, not on every subsequent still-failing firing', () => {
  const ds = fakeDurableState({
    retryQueue: [
      // Already at/above the escalation threshold BEFORE this firing's own
      // failure is recorded — i.e. this fingerprint was already escalated on
      // an earlier firing.
      { fingerprint: 'stuck', payload: { title: 'Stuck' }, firstFailedAt: 'x', attempts: 3, lastError: 'timeout' },
    ],
  });
  const { update } = makeRetryQueueCommands(ds);
  const resultsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'retry-cli-')), 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify([
    { fingerprint: 'stuck', payload: { title: 'Stuck' }, ok: false, error: 'still failing' },
  ]));
  const out = captureStdout(() => update({ root: '/repo', _: ['update', resultsPath] }));
  assert.deepStrictEqual(
    JSON.parse(out),
    [],
    'an already-escalated fingerprint (attempts already >= threshold before this firing) must not be re-reported every firing it keeps failing',
  );
  const persisted = ds.readDurableState().retryQueue;
  assert.strictEqual(
    persisted.find((e) => e.fingerprint === 'stuck').attempts,
    4,
    'attempts must still increment even though it is not re-escalated',
  );
});

test('update prints [] when nothing crosses the escalation threshold', () => {
  const ds = fakeDurableState({ retryQueue: [] });
  const { update } = makeRetryQueueCommands(ds);
  const resultsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'retry-cli-')), 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify([{ fingerprint: 'new', payload: { title: 'New' }, ok: false, error: 'timeout' }]));
  const out = captureStdout(() => update({ root: '/repo', _: ['update', resultsPath] }));
  assert.deepStrictEqual(JSON.parse(out), []);
});

// A relative results path is read against the injected cwd, and a failure message
// prints it exactly as the caller spelled it (not an absolute rebased path).
test('update reads a relative results path against the injected cwd and prints that spelling in its error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-cli-'));
  let out = '';
  let err = '';
  const cmds = makeRetryQueueCommands({
    readDurableState: () => ({ retryQueue: [] }),
    writeDurableState: (r, mutator) => { mutator({ retryQueue: [] }); return { ok: true }; },
    io: { stdout: (t) => { out += t; }, stderr: (t) => { err += t; }, cwd: () => root },
  });
  assert.strictEqual(cmds.update({ _: ['update', 'missing-results.json'] }), 1);
  assert.match(err, /^retry-queue update: could not read or parse missing-results\.json: /);
  assert.ok(!err.includes(root), 'the message must not print the cwd-resolved absolute path');
  fs.writeFileSync(path.join(root, 'results.json'), '[]');
  assert.strictEqual(cmds.update({ _: ['update', 'results.json'] }), 0);
  assert.deepStrictEqual(JSON.parse(out), []);
});

// Pre-#5380 outcomes for two malformed inputs, which a textual path.resolve would change:
// the kernel, not the helper, must see the path exactly as written.
function updateAgainst(cwd, resultsArg) {
  let out = '';
  let err = '';
  const cmds = makeRetryQueueCommands({
    readDurableState: () => ({ retryQueue: [] }),
    writeDurableState: (r, mutator) => { mutator({ retryQueue: [] }); return { ok: true }; },
    io: { stdout: (t) => { out += t; }, stderr: (t) => { err += t; }, cwd: () => cwd },
  });
  const code = cmds.update({ _: ['update', resultsArg] });
  return { code, out, err };
}

test('update keeps a trailing slash on a file path for the kernel: still exit 1 (ENOTDIR), not a silent []', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-cli-'));
  fs.writeFileSync(path.join(root, 'results.json'), '[]');
  const r = updateAgainst(root, 'results.json/');
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /^retry-queue update: could not read or parse results\.json\/: /);
  assert.strictEqual(r.out, '');
});

test('update leaves a `..` after a symlink to the kernel: link/../x resolves through the link target', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-cli-'));
  fs.mkdirSync(path.join(root, 'other', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'other', 'only-there.json'), '[]');
  try {
    fs.symlinkSync(path.join(root, 'other', 'deep'), path.join(root, 'link'), 'dir');
  } catch (e) {
    if (process.platform === 'win32') return t.skip('symlink creation is not permitted here');
    throw e;
  }
  const r = updateAgainst(root, 'link/../only-there.json');
  assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(JSON.parse(r.out), []);
});
