'use strict';
const { scratchDir } = require('../../helpers/tmp-dir');
const { test } = require('node:test');
const assert = require('node:assert');
const {
  HEALTH_STATE_BRANCH,
  MAX_RUN_HISTORY,
  ESCALATE_AFTER_ATTEMPTS,
  MAX_CAS_ATTEMPTS,
  statePath,
  pruneRuns,
  enqueueRetry,
  dequeueRetry,
  shouldEscalate,
  casBackoffMs,
  createDurableState,
  createNamespacedState,
} = require('../../../plugin/bin/lib/health-core/durable-state');
const { LARGE_MAX_BUFFER_BYTES } = require('../../../plugin/bin/lib/shared-primitives');
const { isCatFileBatch, answerCatFileBatch } = require('../../helpers/fake-cat-file-batch');

test('constants', () => {
  assert.strictEqual(HEALTH_STATE_BRANCH, 'health-state');
  assert.strictEqual(MAX_RUN_HISTORY, 90);
  assert.strictEqual(ESCALATE_AFTER_ATTEMPTS, 3);
});

test('statePath namespaces a file under the skill name', () => {
  assert.strictEqual(statePath('code-health', 'cursors.json'), 'code-health/cursors.json');
});

test('pruneRuns keeps only the newest maxCount records, oldest first order preserved', () => {
  const runs = [
    { runId: 'a', runAt: '2026-01-01T00:00:00.000Z' },
    { runId: 'b', runAt: '2026-01-02T00:00:00.000Z' },
    { runId: 'c', runAt: '2026-01-03T00:00:00.000Z' },
  ];
  const pruned = pruneRuns(runs, 2);
  assert.deepStrictEqual(pruned.map((r) => r.runId), ['b', 'c']);
});

test('pruneRuns is a no-op when runs.length <= maxCount', () => {
  const runs = [{ runId: 'a', runAt: '2026-01-01T00:00:00.000Z' }];
  assert.deepStrictEqual(pruneRuns(runs, 90), runs);
});

test('pruneRuns sorts by runAt before slicing, regardless of input order', () => {
  const runs = [
    { runId: 'c', runAt: '2026-01-03T00:00:00.000Z' },
    { runId: 'a', runAt: '2026-01-01T00:00:00.000Z' },
    { runId: 'b', runAt: '2026-01-02T00:00:00.000Z' },
  ];
  assert.deepStrictEqual(pruneRuns(runs, 2).map((r) => r.runId), ['b', 'c']);
});

test('enqueueRetry adds a brand-new fingerprint with attempts:1', () => {
  const next = enqueueRetry([], { fingerprint: 'ch-abc123', payload: { title: 't' } }, { now: 1720000000000 });
  assert.strictEqual(next.length, 1);
  assert.strictEqual(next[0].fingerprint, 'ch-abc123');
  assert.strictEqual(next[0].attempts, 1);
  assert.strictEqual(next[0].firstFailedAt, new Date(1720000000000).toISOString());
});

test('enqueueRetry increments attempts for an existing fingerprint instead of duplicating', () => {
  const queue = [{ fingerprint: 'ch-abc123', payload: { title: 't' }, firstFailedAt: 'x', attempts: 1, lastError: null }];
  const next = enqueueRetry(queue, { fingerprint: 'ch-abc123', payload: { title: 't' }, lastError: 'timeout' }, { now: 1720000000000 });
  assert.strictEqual(next.length, 1);
  assert.strictEqual(next[0].attempts, 2);
  assert.strictEqual(next[0].lastError, 'timeout');
  assert.strictEqual(next[0].firstFailedAt, 'x', 'firstFailedAt must not change on repeat failures');
});

test('dequeueRetry removes only the matching fingerprint', () => {
  const queue = [
    { fingerprint: 'a', attempts: 1 },
    { fingerprint: 'b', attempts: 1 },
  ];
  assert.deepStrictEqual(dequeueRetry(queue, 'a'), [{ fingerprint: 'b', attempts: 1 }]);
});

test('shouldEscalate is true at exactly ESCALATE_AFTER_ATTEMPTS and beyond, false below it', () => {
  assert.strictEqual(shouldEscalate({ attempts: 2 }), false);
  assert.strictEqual(shouldEscalate({ attempts: 3 }), true);
  assert.strictEqual(shouldEscalate({ attempts: 4 }), true);
});

test('shouldEscalate is false for a missing entry', () => {
  assert.strictEqual(shouldEscalate(null), false);
  assert.strictEqual(shouldEscalate(undefined), false);
});

test('casBackoffMs windows never overlap across attempts, guaranteeing a later attempt always waits longer', () => {
  for (let attempt = 1; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    for (let i = 0; i < 20; i++) {
      const a = casBackoffMs(attempt);
      const b = casBackoffMs(attempt + 1);
      assert.ok(a > 0 && b > 0, 'both must be positive durations');
      assert.ok(b > a, `attempt ${attempt + 1}'s backoff (${b}) must exceed attempt ${attempt}'s (${a})`);
    }
  }
});

// --- createDurableState: fake runner records every (cmd, args, opts) call and
// returns canned responses keyed by a simple pattern match on args. `returns`/
// `throws` may be a plain value OR a function of (cmd, args) called lazily on
// each match — use a function whenever a rule needs to react to prior calls
// (a counter, a flag flipped by an earlier matched rule) so the state change
// happens when the fake is actually invoked by the code under test, not once
// eagerly while the script array literal is being built. A `git cat-file
// --batch` call no rule matches is answered by fake-cat-file-batch.js, which
// runs these same rules on one synthetic `git show <ref>:<path>` per object
// (those dispatches are not recorded in `calls` — only the real call is). ---

function fakeRunner(script) {
  const calls = [];
  function applyRules(cmd, args) {
    for (const rule of script) {
      if (rule.match(cmd, args)) {
        const throwsVal = typeof rule.throws === 'function' ? rule.throws(cmd, args) : rule.throws;
        if (throwsVal) throw new Error(throwsVal);
        return { matched: true, value: typeof rule.returns === 'function' ? rule.returns(cmd, args) : rule.returns };
      }
    }
    return { matched: false };
  }
  function run(cmd, args, opts) {
    calls.push({ cmd, args, opts });
    const hit = applyRules(cmd, args);
    if (hit.matched) return hit.value;
    if (isCatFileBatch(cmd, args)) {
      return answerCatFileBatch(args, opts, (showArgs) => {
        const shown = applyRules('git', showArgs);
        if (!shown.matched) throw new Error(`fakeRunner: no rule matched git ${JSON.stringify(showArgs)}`);
        return shown.value;
      });
    }
    throw new Error(`fakeRunner: no rule matched ${cmd} ${JSON.stringify(args)}`);
  }
  return { run, calls };
}

function matchArgs(args, needle) {
  return args.join(' ').includes(needle);
}

// The common writeState success-path rule set (the combined commit+tree
// rev-parse, the single-ref rev-parse used by the ambiguity check, fetch,
// show, and the git-native blob/tree/commit sequence) that every writeState
// test below needs identically -- only the final push rule (matched
// separately via pushRule()) actually varies per test (a plain success, a
// retry-then-succeed, or an always-fail). Extracted so a change to the real
// git call sequence only needs updating in one place instead of many
// near-identical copies.
//
// The static (non-toggling) single-ref rev-parse rule below always returns
// 'commit-sha-1' — this is what the ambiguity check in writeState's catch
// block compares a failed push's commitSha against. Since every test using
// this shared rule set builds commits with sha 'commit-sha-2' (see the
// commit-tree rule), 'commit-sha-2' !== 'commit-sha-1' always, so the
// ambiguity check correctly falls through to a genuine retry rather than
// ever accidentally reporting a false success. Tests that specifically want
// to exercise the "push secretly landed" ambiguous case override this rule
// with their own toggling version instead of spreading this helper.
function baseWriteStateRules() {
  return [
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && matchArgs(args, '^{tree}'), returns: 'commit-sha-1\ntree-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && !matchArgs(args, '^{tree}'), returns: 'commit-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'ls-tree'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'tree-sha-2\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'), returns: 'commit-sha-2\n' },
  ];
}

// The one rule each writeState test genuinely varies on: the final
// `git push origin <sha>:refs/heads/health-state` call. `behavior` is a
// { returns } or { throws } object, matching fakeRunner's own rule shape, so
// callers can pass a plain value or a lazy function exactly as they would
// inline.
function pushRule(behavior) {
  return {
    match: (cmd, args) => cmd === 'git' && matchArgs(args, 'push') && matchArgs(args, 'refs/heads/health-state'),
    ...behavior,
  };
}

// Extracts the bare filenames a mktree call was fed, in the order captured —
// used to assert which files a write's skill-subtree rebuild included.
// `calls` must be filtered to the mktree calls first; index 0 is always the
// skill subtree (built before the root tree — see buildRootTree's ordering).
function mktreeEntryNames(mktreeCall) {
  return mktreeCall.opts.input.split('\0').filter(Boolean).map((line) => line.split('\t')[1]);
}

test('readState returns empty defaults when the branch does not exist yet (includeRemembered:true skill)', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), throws: "couldn't find remote ref health-state" },
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  const state = ds.readState('/repo');
  assert.deepStrictEqual(state, { cursors: {}, remembered: {}, retryQueue: [], runs: [] });
});

function withCapturedStderr(fn) {
  let out = '';
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { out += chunk; return true; };
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return out;
}

test('readState stays silent on a genuinely first-ever run (branch simply does not exist yet)', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), throws: "couldn't find remote ref health-state" },
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  const stderrOut = withCapturedStderr(() => ds.readState('/repo'));
  assert.strictEqual(stderrOut, '', 'a genuine first run must not be logged as if it were a failure');
});

test('readState writes a stderr trace on a genuine fetch failure, distinguishing it from a first-ever run', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), throws: 'fatal: unable to access https://github.com/x/y.git/: Could not resolve host: github.com' },
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  let state;
  const stderrOut = withCapturedStderr(() => { state = ds.readState('/repo'); });
  assert.deepStrictEqual(state, { cursors: {}, remembered: {}, retryQueue: [], runs: [] }, 'still degrades to empty defaults, never throws');
  assert.ok(stderrOut.includes('fetch failed'), `expected a fetch-failure trace in stderr: ${stderrOut}`);
});

test('createNamespacedState threads env into every git call and routes the fetch-failure trace to the injected stderr', () => {
  const env = { MARKER: '1' };
  const envs = [];
  const run = (cmd, args, opts = {}) => {
    envs.push(opts.env);
    if (args.includes('fetch')) throw new Error('fatal: unable to access');
    return '';
  };
  let err = '';
  const ns = createNamespacedState('ns', [{ key: 'a', file: 'a.json', default: {} }], { run, env, stderr: (t) => { err += t; } });
  ns.readState('/repo');
  assert.ok(envs.length > 0, 'the fake run must have been called');
  for (const e of envs) assert.strictEqual(e, env);
  assert.match(err, /^health-state: fetch failed/);
});

test('createNamespacedState with an injected env also wraps the write path (every git call carries env)', () => {
  const env = { MARKER: '2' };
  const envs = [];
  const run = (cmd, args, opts = {}) => {
    envs.push(opts.env);
    if (args.includes('rev-parse')) return `${'a'.repeat(40)}\n${'b'.repeat(40)}\n`;
    return `${'c'.repeat(40)}\n`;
  };
  const ns = createNamespacedState('ns', [{ key: 'a', file: 'a.json', default: {} }], { run, sleep: () => {}, env });
  ns.writeState('/repo', (current) => current);
  assert.ok(envs.length > 5);
  for (const e of envs) assert.strictEqual(e, env);
});

test('createNamespacedState without env leaves a caller-supplied run untouched (no env key added)', () => {
  const seen = [];
  const run = (cmd, args, opts) => { seen.push(opts); return ''; };
  createNamespacedState('ns', [{ key: 'a', file: 'a.json', default: {} }], { run }).readState('/repo');
  assert.ok(seen.length > 0);
  for (const o of seen) assert.ok(o === undefined || !('env' in o), 'no env key may appear when none was injected');
});

test('createDurableState passes env through to its git calls', () => {
  const env = { MARKER: '3' };
  const envs = [];
  const run = (cmd, args, opts = {}) => { envs.push(opts.env); return ''; };
  createDurableState('code-health', { run, sleep: () => {}, env }).readState('/repo');
  assert.ok(envs.length > 0);
  for (const e of envs) assert.strictEqual(e, env);
});

test('createNamespacedState with env and no run builds its runner on makeExec: a real git failure is captured, not leaked', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const dir = scratchDir('ns-exec-');
  let err = '';
  const ns = createNamespacedState('ns', [{ key: 'a', file: 'a.json', default: { d: 1 } }], {
    env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) }, stderr: (t) => { err += t; },
  });
  const realWrite = process.stderr.write;
  const leaked = [];
  process.stderr.write = (...a) => { leaked.push(a[0]); return true; };
  let state;
  try { state = ns.readState(dir); } finally { process.stderr.write = realWrite; }
  assert.deepStrictEqual(state, { a: { d: 1 } });
  assert.deepStrictEqual(leaked, []);
  assert.match(err, /health-state: fetch failed/);
});

test('createNamespacedState with only a stderr (no env, no run) captures a real git failure instead of leaking it', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const dir = scratchDir('ns-stderr-only-');
  let err = '';
  const ns = createNamespacedState('ns', [{ key: 'a', file: 'a.json', default: { d: 1 } }], {
    stderr: (t) => { err += t; },
  });
  const realWrite = process.stderr.write;
  const leaked = [];
  process.stderr.write = (...a) => { leaked.push(a[0]); return true; };
  let state;
  try { state = ns.readState(dir); } finally { process.stderr.write = realWrite; }
  assert.deepStrictEqual(state, { a: { d: 1 } });
  assert.deepStrictEqual(leaked, [], 'nothing may reach process.stderr when a stderr sink is injected');
  assert.match(err, /health-state: fetch failed/);
});

test('readState parses each file via the batched read, defaulting missing files to {}/[]', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'cursors.json'), returns: JSON.stringify({ '.': { lastSweptMs: 1 } }) },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'remembered.json'), throws: 'fatal: path does not exist' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'retry-queue.json'), returns: '[]' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'runs.json'), returns: '[]' },
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  const state = ds.readState('/repo');
  assert.deepStrictEqual(state.cursors, { '.': { lastSweptMs: 1 } });
  assert.deepStrictEqual(state.remembered, {});
  assert.deepStrictEqual(state.retryQueue, []);
  assert.deepStrictEqual(state.runs, []);
});

test('readState omits the remembered key entirely for a skill that does not opt in (includeRemembered defaults to false)', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
  ]);
  const ds = createDurableState('harness-health', { run, sleep: () => {} });
  const state = ds.readState('/repo');
  assert.deepStrictEqual(state, { cursors: {}, retryQueue: [], runs: [] });
  assert.ok(!('remembered' in state), 'a skill that never opts in must never see a remembered key at all');
});

test('AC5.1: a read round at a resolving ref starts exactly one git process for every file spec, a cat-file --batch fed one ref:path line per spec', () => {
  const { run, calls } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show') && matchArgs(args, 'cursors.json'), returns: JSON.stringify({ '.': { lastSweptMs: 7 } }) },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true, includeDeclined: true });
  const state = ds.readState('/repo');
  assert.deepStrictEqual(state, { cursors: { '.': { lastSweptMs: 7 } }, retryQueue: [], runs: [], remembered: {}, declined: {} });
  const reads = calls.filter((c) => c.cmd === 'git' && !c.args.includes('fetch'));
  assert.strictEqual(reads.length, 1);
  assert.deepStrictEqual(reads[0].args, ['-C', '/repo', 'cat-file', '--batch']);
  assert.ok(Buffer.isBuffer(reads[0].opts.input), 'input must be a Buffer: a string input with encoding buffer throws ERR_UNKNOWN_ENCODING');
  assert.strictEqual(reads[0].opts.input.toString('utf8'), ['cursors.json', 'retry-queue.json', 'runs.json', 'remembered.json', 'declined.json']
    .map((f) => `origin/health-state:code-health/${f}\n`).join(''));
  assert.strictEqual(reads[0].opts.encoding, 'buffer');
  assert.strictEqual(reads[0].opts.maxBuffer, LARGE_MAX_BUFFER_BYTES);
});

// Reads `fileSpecs` under namespace `ns` through a fake whose cat-file rule
// returns `response` verbatim (rule-first, so fake-cat-file-batch.js is bypassed).
function readWithBatchResponse(fileSpecs, response) {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'cat-file'), returns: response },
  ]);
  return createNamespacedState('ns', fileSpecs, { run, sleep: () => {} }).readState('/repo');
}

test('a non-blob slot degrades to its default and the following blob still reads (byte-length framing skips the tree body)', () => {
  const response = Buffer.concat([Buffer.from(`${'e'.repeat(40)} tree 5\nabcde\n`), Buffer.from(`${'b'.repeat(40)} blob 9\n{"k":"v"}\n`)]);
  const state = readWithBatchResponse([{ key: 'a', file: 'a.json', default: { d: 1 } }, { key: 'b', file: 'b.json', default: {} }], response);
  assert.deepStrictEqual(state, { a: { d: 1 }, b: { k: 'v' } });
});

test('a truncated batch stream degrades the unread slots to defaults and never throws', () => {
  const response = `${'b'.repeat(40)} blob 9\n{"k":"v"}\n`;
  const state = readWithBatchResponse([
    { key: 'a', file: 'a.json', default: {} },
    { key: 'b', file: 'b.json', default: { d: 2 } },
    { key: 'c', file: 'c.json', default: [3] },
  ], response);
  assert.deepStrictEqual(state, { a: { k: 'v' }, b: { d: 2 }, c: [3] });
});

test('a header claiming more bytes than the stream holds degrades that slot and every later one, never reading the short body', () => {
  // Without the length guard the short remainder `{"k":"v"}\n` would be sliced and parsed as slot a.
  const response = `${'a'.repeat(40)} blob 50\n{"k":"v"}\n`;
  const state = readWithBatchResponse([{ key: 'a', file: 'a.json', default: { d: 1 } }, { key: 'b', file: 'b.json', default: { d: 2 } }], response);
  assert.deepStrictEqual(state, { a: { d: 1 }, b: { d: 2 } });
});

test('a string response is framed by bytes, so a multi-byte first slot does not misframe the next', () => {
  const first = '{"n":"café ☕"}';
  const response = `${'a'.repeat(40)} blob ${Buffer.byteLength(first)}\n${first}\n${'b'.repeat(40)} blob 9\n{"k":"v"}\n`;
  const state = readWithBatchResponse([{ key: 'a', file: 'a.json', default: {} }, { key: 'b', file: 'b.json', default: {} }], response);
  assert.deepStrictEqual(state, { a: { n: 'café ☕' }, b: { k: 'v' } });
});

test('missing and ambiguous headers degrade only their own slot', () => {
  const response = `origin/health-state:ns/a.json missing\norigin/health-state:ns/b.json ambiguous\n${'c'.repeat(40)} blob 2\n[]\n`;
  const state = readWithBatchResponse([
    { key: 'a', file: 'a.json', default: { d: 'a' } },
    { key: 'b', file: 'b.json', default: { d: 'b' } },
    { key: 'c', file: 'c.json', default: { d: 'c' } },
  ], response);
  assert.deepStrictEqual(state, { a: { d: 'a' }, b: { d: 'b' }, c: [] });
});

test('a failed batch process degrades every spec to its default', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'cat-file'), throws: 'fatal: not a git repository' },
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true, includeDeclined: true });
  let state;
  const stderrOut = withCapturedStderr(() => { state = ds.readState('/repo'); });
  assert.deepStrictEqual(state, { cursors: {}, retryQueue: [], runs: [], remembered: {}, declined: {} });
  assert.strictEqual(stderrOut, '');
});

test('AC3.1: the default runner gives the batch read the 30 s timeout, windowsHide, a 64 MiB maxBuffer, encoding buffer and a Buffer input', () => {
  const childProcess = require('child_process');
  const modulePath = require.resolve('../../../plugin/bin/lib/health-core/durable-state');
  const realExecFileSync = childProcess.execFileSync;
  const calls = [];
  childProcess.execFileSync = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (typeof opts.input === 'string' && opts.encoding === 'buffer') {
      const err = new TypeError('Unknown encoding: buffer');
      err.code = 'ERR_UNKNOWN_ENCODING';
      throw err;
    }
    if (args.includes('fetch')) return '';
    if (args.includes('cat-file')) return Buffer.from('');
    throw new Error(`unexpected call ${cmd} ${JSON.stringify(args)}`);
  };
  delete require.cache[modulePath];
  try {
    const fresh = require(modulePath);
    fresh.createNamespacedState('ns', [{ key: 'a', file: 'a.json', default: {} }]).readState('/repo');
  } finally {
    childProcess.execFileSync = realExecFileSync;
    delete require.cache[modulePath];
  }
  const batch = calls.find((c) => c.args.includes('cat-file'));
  assert.ok(batch, 'the default runner must start a cat-file --batch read');
  assert.deepStrictEqual(batch.args, ['-C', '/repo', 'cat-file', '--batch']);
  assert.strictEqual(batch.opts.timeout, 30000);
  assert.strictEqual(batch.opts.windowsHide, true);
  assert.strictEqual(batch.opts.encoding, 'buffer');
  assert.strictEqual(batch.opts.maxBuffer, LARGE_MAX_BUFFER_BYTES);
  assert.ok(Buffer.isBuffer(batch.opts.input), 'a string input with encoding buffer throws ERR_UNKNOWN_ENCODING in the real call');
  assert.strictEqual(batch.opts.input.toString('utf8'), 'origin/health-state:ns/a.json\n');
});

test('writeState succeeds on the first attempt: fetch, read, build blobs/tree/commit, push', () => {
  const written = {};
  const { run } = fakeRunner([
    ...baseWriteStateRules(),
    pushRule({ returns: () => { written.updated = true; return ''; } }),
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  const result = ds.writeState('/repo', (current) => ({ ...current, cursors: { '.': { lastSweptMs: 2 } } }));
  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(written.updated, true);
});

const isStateRead = (c) => c.cmd === 'git' && (c.args.includes('show') || c.args.includes('cat-file'));

test('AC4.1: writeState against an unresolvable origin/health-state starts no state-file read and hands the mutator the defaults', () => {
  const { run, calls } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), throws: "couldn't find remote ref health-state" },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse'), throws: 'unknown revision or path not in the working tree' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), returns: JSON.stringify({ stale: true }) },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'cat-file'), returns: 'x blob 2\n{}\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'tree-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'), returns: 'commit-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'push'), returns: '' },
  ]);
  let seen = null;
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  assert.deepStrictEqual(ds.writeState('/repo', (current) => { seen = current; return current; }), { ok: true });
  assert.deepStrictEqual(seen, { cursors: {}, retryQueue: [], runs: [], remembered: {} });
  assert.strictEqual(calls.filter(isStateRead).length, 0, 'no show/cat-file may run when the ref does not resolve');
});

test('writeState reads the state files at the commit sha rev-parse resolved, the same commit it parents the new one on', () => {
  const { run, calls } = fakeRunner([...baseWriteStateRules(), pushRule({ returns: '' })]);
  const ds = createDurableState('code-health', { run, sleep: () => {} });
  assert.deepStrictEqual(ds.writeState('/repo', (current) => current), { ok: true });
  const reads = calls.filter(isStateRead);
  assert.ok(reads.length > 0);
  const readText = reads.map((c) => `${c.args.join(' ')} ${c.opts && c.opts.input ? c.opts.input : ''}`).join('\n');
  assert.match(readText, /commit-sha-1:code-health\/cursors\.json/);
  assert.doesNotMatch(readText, /origin\/health-state:/);
});

test('writeState retries on a rejected (non-fast-forward) push, then succeeds', () => {
  let pushAttempts = 0;
  const { run } = fakeRunner([
    ...baseWriteStateRules(),
    pushRule({
      returns: () => {
        pushAttempts += 1;
        if (pushAttempts === 1) throw new Error('! [rejected] health-state -> health-state (non-fast-forward)');
        return '';
      },
    }),
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  const result = ds.writeState('/repo', (current) => ({ ...current, cursors: { '.': { lastSweptMs: 2 } } }));
  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(pushAttempts, 2, 'must retry the whole read-modify-write cycle after a rejection');
});

test('writeState gives up gracefully (no throw) after MAX_CAS_ATTEMPTS exhausted', () => {
  const { run } = fakeRunner([
    ...baseWriteStateRules(),
    pushRule({ throws: '! [rejected] health-state -> health-state (non-fast-forward)' }),
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  const result = ds.writeState('/repo', (current) => current);
  assert.strictEqual(result.ok, false);
  assert.ok(result.error, 'must report why it gave up');
});

test('writeState waits an increasing, jittered interval between CAS retry attempts', () => {
  const { run } = fakeRunner([
    ...baseWriteStateRules(),
    pushRule({ throws: '! [rejected] health-state -> health-state (non-fast-forward)' }),
  ]);
  const sleepCalls = [];
  const ds = createDurableState('code-health', { run, sleep: (ms) => sleepCalls.push(ms), includeRemembered: true });
  const result = ds.writeState('/repo', (current) => current);
  assert.strictEqual(result.ok, false, 'sanity check: this scenario exhausts every attempt, same as the test above');
  assert.strictEqual(sleepCalls.length, MAX_CAS_ATTEMPTS - 1, 'sleeps between attempts, never after the final exhausted one');
  for (const ms of sleepCalls) assert.ok(ms > 0, `every wait must be a positive duration, got ${ms}`);
  for (let i = 1; i < sleepCalls.length; i++) {
    assert.ok(sleepCalls[i] > sleepCalls[i - 1], `wait must increase across attempts: ${sleepCalls}`);
  }
});

test('writeState bootstraps a branch that does not exist yet: the first commit has no parent, and a single push both creates and populates the branch', () => {
  const commitTreeCalls = [];
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), throws: "couldn't find remote ref health-state" },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && matchArgs(args, '^{tree}'), throws: 'unknown revision or path not in the working tree' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'tree-sha-1\n' },
    {
      match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'),
      returns: (cmd, args) => { commitTreeCalls.push(args); return 'commit-sha-1\n'; },
    },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'push'), returns: '' },
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  const result = ds.writeState('/repo', (current) => current);
  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(commitTreeCalls.length, 1, 'a brand-new branch is created in exactly one attempt, one commit');
  assert.ok(!commitTreeCalls[0].includes('-p'), 'the very first commit on a brand-new branch must have no parent (-p omitted)');
});

test('writeState never throws, even when every attempt fails on a from-scratch (never-existing) branch', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), throws: "couldn't find remote ref health-state" },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && matchArgs(args, '^{tree}'), throws: 'unknown revision or path not in the working tree' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && !matchArgs(args, '^{tree}'), throws: 'unknown revision or path not in the working tree' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'tree-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'), returns: 'commit-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'push'), throws: 'fatal: could not read Username for https://github.com: terminal prompts disabled' },
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  let result;
  assert.doesNotThrow(() => {
    result = ds.writeState('/repo', (current) => current);
  }, 'writeState must never throw, even when every attempt fails on a brand-new branch');
  assert.strictEqual(result.ok, false);
  assert.ok(result.error, 'must report why it gave up after exhausting CAS retries');
});

test('writeState fetches exactly once per CAS-loop attempt on a clean success: the ambiguity-check re-fetch only fires after a push failure', () => {
  let fetchCount = 0;
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && matchArgs(args, '^{tree}'), returns: 'commit-sha-1\ntree-sha-1\n' },
    {
      match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'),
      returns: () => {
        fetchCount += 1;
        if (fetchCount > 1) throw new Error('a second fetch happened on a clean, single-attempt success — the ambiguity-check re-fetch must only run after a push failure');
        return '';
      },
    },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show') && matchArgs(args, 'cursors.json'), returns: JSON.stringify({ '.': { lastSweptMs: 5 } }) },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show') && matchArgs(args, 'retry-queue.json'), returns: '[]' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show') && matchArgs(args, 'runs.json'), returns: '[]' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show') && matchArgs(args, 'remembered.json'), returns: '{}' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'ls-tree'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'tree-sha-2\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'), returns: 'commit-sha-2\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'push'), returns: '' },
  ]);
  let seenCurrent = null;
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  const result = ds.writeState('/repo', (current) => {
    seenCurrent = current;
    return { ...current, cursors: { ...current.cursors, updated: true } };
  });
  assert.deepStrictEqual(result, { ok: true });
  assert.deepStrictEqual(seenCurrent.cursors, { '.': { lastSweptMs: 5 } }, 'mutator must see state read from the already-fetched branch tip, not a degraded-empty fallback');
  assert.strictEqual(fetchCount, 1, 'exactly one fetch on a clean, single-attempt success — there is no separate ensureBranch pre-check to add a second one anymore');
});

test('writeState resolves the parent commit sha and base tree sha from a SINGLE combined rev-parse call, not two separate subprocess spawns', () => {
  let revParseCallCount = 0;
  const { run } = fakeRunner([
    {
      match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && matchArgs(args, '^{tree}'),
      returns: () => { revParseCallCount += 1; return 'commit-sha-1\ntree-sha-1\n'; },
    },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'ls-tree'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'tree-sha-2\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'), returns: 'commit-sha-2\n' },
    pushRule({ returns: '' }),
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  const result = ds.writeState('/repo', (current) => current);
  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(revParseCallCount, 1, 'the CAS loop must resolve both the parent commit sha AND the base tree sha from one rev-parse call, not two');
});

test('writeState treats a rejected-looking push as success (and does not retry the mutator a second time) when the ref actually already points at the commit we just tried to set — an ambiguous push failure where the update landed server-side but the local process never saw confirmation', () => {
  let mutatorCalls = 0;
  let pushAttempted = false;
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && matchArgs(args, '^{tree}'), returns: 'commit-sha-1\ntree-sha-1\n' },
    {
      // The ambiguity-check's re-fetch plus its rev-parse must report the NEW
      // commit (commit-sha-2, the one writeCommit built) once the push has
      // been attempted — simulating the real world where the push really did
      // land even though the local git process saw an error.
      match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && !matchArgs(args, '^{tree}'),
      returns: () => (pushAttempted ? 'commit-sha-2\n' : 'commit-sha-1\n'),
    },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'ls-tree'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'tree-sha-2\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'), returns: 'commit-sha-2\n' },
    pushRule({
      returns: () => {
        pushAttempted = true;
        throw new Error('network drop after origin applied the push');
      },
    }),
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  const result = ds.writeState('/repo', (current) => {
    mutatorCalls += 1;
    return { ...current, retryQueue: [] };
  });
  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(mutatorCalls, 1, 'mutator must not be re-invoked once the push is confirmed to have actually landed — a second invocation would double-apply a non-idempotent mutator like enqueueRetry\'s attempts++');
});

test('writeState still retries normally on a GENUINE rejection (ref moved to a DIFFERENT commit, not ours) — the ambiguity check must not swallow a real conflict', () => {
  // baseWriteStateRules()'s single-ref rev-parse rule is static (always
  // 'commit-sha-1'), so the ambiguity check's currentCommitSha(root) ===
  // commitSha comparison ('commit-sha-2' !== 'commit-sha-1') correctly falls
  // through to a real retry, proving the fix doesn't change behavior for a
  // genuine conflict.
  let pushAttempts = 0;
  const { run } = fakeRunner([
    ...baseWriteStateRules(),
    pushRule({
      returns: () => {
        pushAttempts += 1;
        if (pushAttempts === 1) throw new Error('! [rejected] health-state -> health-state (non-fast-forward)');
        return '';
      },
    }),
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  const result = ds.writeState('/repo', (current) => ({ ...current, cursors: { '.': { lastSweptMs: 2 } } }));
  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(pushAttempts, 2, 'a genuine rejection must still retry the whole read-modify-write cycle');
});

test('writeState includes a remembered.json blob only for a skill that opts in', () => {
  const { run, calls } = fakeRunner([
    ...baseWriteStateRules(),
    pushRule({ returns: '' }),
  ]);
  const ds = createDurableState('code-health', { run, sleep: () => {}, includeRemembered: true });
  const result = ds.writeState('/repo', (current) => current);
  assert.deepStrictEqual(result, { ok: true });
  const skillTreeCall = calls.filter((c) => c.cmd === 'git' && c.args.includes('mktree'))[0];
  assert.deepStrictEqual(mktreeEntryNames(skillTreeCall).sort(), ['cursors.json', 'remembered.json', 'retry-queue.json', 'runs.json']);
});

test('writeState never includes a remembered.json blob for a skill that does not opt in', () => {
  const { run, calls } = fakeRunner([
    ...baseWriteStateRules(),
    pushRule({ returns: '' }),
  ]);
  const ds = createDurableState('harness-health', { run, sleep: () => {} });
  const result = ds.writeState('/repo', (current) => current);
  assert.deepStrictEqual(result, { ok: true });
  const skillTreeCall = calls.filter((c) => c.cmd === 'git' && c.args.includes('mktree'))[0];
  assert.deepStrictEqual(mktreeEntryNames(skillTreeCall).sort(), ['cursors.json', 'retry-queue.json', 'runs.json']);
});

test('writeState preserves an existing file in the skill subtree that this write does not touch (the git-native analog of the old base_tree partial-update guarantee)', () => {
  const { run, calls } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && matchArgs(args, '^{tree}'), returns: 'commit-sha-1\ntree-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
    // Root tree already has an entry for this skill; its subtree already has
    // a remembered.json this write does NOT own (includeRemembered:false
    // below) — it must survive untouched in the rebuilt subtree.
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'ls-tree') && matchArgs(args, 'tree-sha-1'), returns: '040000 tree existing-skill-tree-sha\tharness-health\0' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'ls-tree') && matchArgs(args, 'existing-skill-tree-sha'), returns: '100644 blob stale-remembered-sha\tremembered.json\0' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'tree-sha-2\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'), returns: 'commit-sha-2\n' },
    pushRule({ returns: '' }),
  ]);
  const ds = createDurableState('harness-health', { run, sleep: () => {} }); // includeRemembered NOT set — this write never owns remembered.json
  const result = ds.writeState('/repo', (current) => current);
  assert.deepStrictEqual(result, { ok: true });
  const skillTreeCall = calls.filter((c) => c.cmd === 'git' && c.args.includes('mktree'))[0];
  const entries = skillTreeCall.opts.input.split('\0').filter(Boolean).map((line) => {
    const [meta, name] = line.split('\t');
    const [mode, type, sha] = meta.split(' ');
    return { name, mode, type, sha };
  });
  const remembered = entries.find((e) => e.name === 'remembered.json');
  assert.ok(remembered, 'the pre-existing remembered.json must survive in the rebuilt subtree');
  assert.strictEqual(remembered.sha, 'stale-remembered-sha', 'its sha must be untouched — this write never read or wrote its content');
  assert.deepStrictEqual(entries.map((e) => e.name).sort(), ['cursors.json', 'remembered.json', 'retry-queue.json', 'runs.json']);
});

test('writeState preserves existing root-tree entries for other skills when one skill writes (multi-skill shared root tree)', () => {
  const { run, calls } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && matchArgs(args, '^{tree}'), returns: 'commit-sha-1\ntree-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
    // Root tree already contains entries for both code-health and harness-health;
    // this write is via harness-health, so harness-health's subtree will be rebuilt,
    // but code-health's root entry must survive untouched.
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'ls-tree') && matchArgs(args, 'tree-sha-1'), returns: '040000 tree code-health-original-tree-sha\tcode-health\u0000040000 tree hh-original-tree-sha\tharness-health\0' },
    // harness-health's existing subtree (can be empty for this test)
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'ls-tree') && matchArgs(args, 'hh-original-tree-sha'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'new-tree-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'), returns: 'commit-sha-2\n' },
    pushRule({ returns: '' }),
  ]);
  const ds = createDurableState('harness-health', { run, sleep: () => {} });
  const result = ds.writeState('/repo', (current) => current);
  assert.deepStrictEqual(result, { ok: true });

  // Extract the root-tree-level mktree call (the SECOND one, after the skill-subtree one)
  const mktreeCalls = calls.filter((c) => c.cmd === 'git' && c.args.includes('mktree'));
  assert.strictEqual(mktreeCalls.length, 2, 'two mktree calls: skill subtree, then root tree');

  const rootTreeCall = mktreeCalls[1]; // Second mktree call is the root tree
  const rootEntries = rootTreeCall.opts.input.split('\0').filter(Boolean).map((line) => {
    const [meta, name] = line.split('\t');
    const [mode, type, sha] = meta.split(' ');
    return { name, mode, type, sha };
  });

  // Verify code-health (untouched), harness-health (updated)
  const codeHealthEntry = rootEntries.find((e) => e.name === 'code-health');
  const hhEntry = rootEntries.find((e) => e.name === 'harness-health');

  assert.ok(codeHealthEntry, 'root tree must preserve code-health entry');
  assert.strictEqual(codeHealthEntry.sha, 'code-health-original-tree-sha', 'code-health sha must be unchanged (harness-health write does not touch it)');

  assert.ok(hhEntry, 'root tree must contain harness-health entry');
  assert.strictEqual(hhEntry.sha, 'new-tree-sha', 'harness-health sha is the newly-built skill-subtree sha');
});

// --- Record #3651: tree reads/writes carry NUL-terminated records, so a name
// git would C-quote (non-ASCII under core.quotepath=true) stays a raw name. ---

test('AC1.1: readTreeEntries reads ls-tree with -z --end-of-options and writeTree feeds mktree -z NUL-terminated records', () => {
  const { run, calls } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && matchArgs(args, '^{tree}'), returns: 'commit-sha-1\ntree-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'ls-tree') && matchArgs(args, 'tree-sha-1'), returns: '040000 tree existing-skill-tree-sha\tharness-health\0' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'ls-tree') && matchArgs(args, 'existing-skill-tree-sha'), returns: '100644 blob cafe-sha\tcafé.json\0' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'tree-sha-2\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'), returns: 'commit-sha-2\n' },
    pushRule({ returns: '' }),
  ]);
  const ds = createDurableState('harness-health', { run, sleep: () => {} });
  assert.deepStrictEqual(ds.writeState('/repo', (current) => current), { ok: true });

  const lsTreeCalls = calls.filter((c) => c.cmd === 'git' && c.args.includes('ls-tree'));
  assert.deepStrictEqual(lsTreeCalls[0].args, ['-C', '/repo', 'ls-tree', '-z', '--end-of-options', 'tree-sha-1']);
  assert.deepStrictEqual(lsTreeCalls[1].args, ['-C', '/repo', 'ls-tree', '-z', '--end-of-options', 'existing-skill-tree-sha']);

  const mktreeCalls = calls.filter((c) => c.cmd === 'git' && c.args.includes('mktree'));
  assert.deepStrictEqual(mktreeCalls[0].args, ['-C', '/repo', 'mktree', '-z']);
  assert.deepStrictEqual(mktreeCalls[1].args, ['-C', '/repo', 'mktree', '-z']);
  const skillInput = mktreeCalls[0].opts.input;
  assert.ok(skillInput.includes('100644 blob cafe-sha\tcafé.json\0'), 'the raw non-ASCII name is carried through, NUL-terminated');
  assert.ok(skillInput.endsWith('\0'), 'every record ends with NUL');
  assert.ok(!skillInput.includes('\n'), 'no newline separators remain');
  assert.strictEqual(mktreeCalls[1].opts.input, '040000 tree tree-sha-2\tharness-health\0');
});

test('AC1.1: writeTree of an empty entry map feeds mktree an empty input (no trailing NUL)', () => {
  const { run, calls } = fakeRunner([
    ...baseWriteStateRules(),
    pushRule({ returns: '' }),
  ]);
  // A namespace with no files writes an empty subtree: zero specs.
  const ds = createNamespacedState('empty-ns', [], { run, sleep: () => {} });
  assert.deepStrictEqual(ds.writeState('/repo', () => ({})), { ok: true });
  const mktreeCalls = calls.filter((c) => c.cmd === 'git' && c.args.includes('mktree'));
  assert.strictEqual(mktreeCalls[0].opts.input, '');
  assert.deepStrictEqual(mktreeCalls[0].args, ['-C', '/repo', 'mktree', '-z']);
});

test('AC1.1: a tree entry named café.json round-trips through readTreeEntries and writeTree in a real repo (core.quotepath true)', () => {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { writeIdentity } = require('../../helpers/git-fixtures');
  const g = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const dir = scratchDir('durable-state-z-');
  try {
    const origin = path.join(dir, 'origin.git');
    const clone = path.join(dir, 'clone');
    g(['init', '--bare', '-q', '-b', 'main', origin]);
    g(['clone', '-q', origin, clone]);
    writeIdentity(clone, { name: 'Test', email: 'test@example.com' });
    g(['-C', clone, 'config', 'core.quotepath', 'true']);

    const cafeSpec = [{ key: 'cafe', file: 'café.json', default: {} }];
    const otherSpec = [{ key: 'other', file: 'other.json', default: {} }];
    const sleep = () => {};
    const cafe = createNamespacedState('ns', cafeSpec, { sleep });
    const other = createNamespacedState('ns', otherSpec, { sleep });

    assert.deepStrictEqual(cafe.writeState(clone, () => ({ cafe: { n: 1 } })), { ok: true });
    // A second writer on the same namespace rebuilds its subtree from the entry map
    // readTreeEntries returned: café.json must survive it untouched.
    assert.deepStrictEqual(other.writeState(clone, () => ({ other: { n: 2 } })), { ok: true });

    g(['-C', clone, 'fetch', '-q', 'origin', 'health-state']);
    const treeAfterOther = g(['-C', clone, 'rev-parse', 'origin/health-state^{tree}']).trim();
    const names = g(['-C', clone, 'ls-tree', '-r', '-z', '--name-only', '--end-of-options', 'origin/health-state']).split('\0').filter(Boolean);
    assert.deepStrictEqual(names.sort(), ['ns/café.json', 'ns/other.json']);
    assert.ok(!names.some((n) => n.includes('\\303')), 'no C-quoted form of the name');
    assert.deepStrictEqual(cafe.readState(clone), { cafe: { n: 1 } });

    // Re-writing identical content through the same entry-map path yields the same tree sha.
    assert.deepStrictEqual(cafe.writeState(clone, (cur) => cur), { ok: true });
    g(['-C', clone, 'fetch', '-q', 'origin', 'health-state']);
    assert.strictEqual(g(['-C', clone, 'rev-parse', 'origin/health-state^{tree}']).trim(), treeAfterOther);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a real repo round-trips multi-byte, multi-line JSON, an invalid-JSON file and a missing file through the batch read', () => {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { writeIdentity } = require('../../helpers/git-fixtures');
  const g = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const dir = scratchDir('durable-state-batch-');
  try {
    const origin = path.join(dir, 'origin.git');
    const clone = path.join(dir, 'clone');
    g(['init', '--bare', '-q', '-b', 'main', origin]);
    g(['clone', '-q', origin, clone]);
    writeIdentity(clone, { name: 'Test', email: 'test@example.com' });

    const sleep = () => {};
    const writer = createNamespacedState('ns', [
      { key: 'a', file: 'a.json', default: {} },
      { key: 'bad', file: 'bad.json', default: {}, serialize: () => '{nope' },
    ], { sleep });
    assert.deepStrictEqual(writer.writeState(clone, () => ({ a: { note: 'café ☕\nline two', n: [1, 2] } })), { ok: true });

    const reader = createNamespacedState('ns', [
      { key: 'a', file: 'a.json', default: {} },
      { key: 'bad', file: 'bad.json', default: { fallback: true } },
      { key: 'gone', file: 'gone.json', default: [] },
    ], { sleep });
    assert.deepStrictEqual(reader.readState(clone), { a: { note: 'café ☕\nline two', n: [1, 2] }, bad: { fallback: true }, gone: [] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- includeDeclined: durable persistence for the 'declined' dismissal mark
// (mirrors includeRemembered's opt-in-flag pattern above) ---

test('readState omits the declined key entirely for a skill that does not opt in (includeDeclined defaults to false)', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
  ]);
  const ds = createDurableState('harness-health', { run, sleep: () => {} });
  const state = ds.readState('/repo');
  assert.ok(!('declined' in state), 'a skill that never opts in must never see a declined key at all');
});

test('readState parses declined.json via the batched read for a skill that opts in, defaulting to {} when missing', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'declined.json'), returns: JSON.stringify({ 'hh-abc123': { lastSeenMs: 1 } }) },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
  ]);
  const ds = createDurableState('harness-health', { run, sleep: () => {}, includeDeclined: true });
  const state = ds.readState('/repo');
  assert.deepStrictEqual(state.declined, { 'hh-abc123': { lastSeenMs: 1 } });
});

test('readState degrades declined to {} (not thrown/missing) when the branch does not exist yet, for a skill that opts in', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), throws: "couldn't find remote ref health-state" },
  ]);
  const ds = createDurableState('harness-health', { run, sleep: () => {}, includeDeclined: true });
  const state = ds.readState('/repo');
  assert.deepStrictEqual(state, { cursors: {}, declined: {}, retryQueue: [], runs: [] });
});

test('writeState includes a declined.json blob only for a skill that opts in', () => {
  const { run, calls } = fakeRunner([
    ...baseWriteStateRules(),
    pushRule({ returns: '' }),
  ]);
  const ds = createDurableState('harness-health', { run, sleep: () => {}, includeDeclined: true });
  const result = ds.writeState('/repo', (current) => ({ ...current, declined: { ...(current.declined || {}), 'hh-abc123': { lastSeenMs: 1 } } }));
  assert.deepStrictEqual(result, { ok: true });
  const skillTreeCall = calls.filter((c) => c.cmd === 'git' && c.args.includes('mktree'))[0];
  assert.deepStrictEqual(mktreeEntryNames(skillTreeCall).sort(), ['cursors.json', 'declined.json', 'retry-queue.json', 'runs.json']);
});

test('writeState never includes a declined.json blob for a skill that does not opt in', () => {
  const { run, calls } = fakeRunner([
    ...baseWriteStateRules(),
    pushRule({ returns: '' }),
  ]);
  const ds = createDurableState('journey-health', { run, sleep: () => {} });
  const result = ds.writeState('/repo', (current) => current);
  assert.deepStrictEqual(result, { ok: true });
  const skillTreeCall = calls.filter((c) => c.cmd === 'git' && c.args.includes('mktree'))[0];
  assert.deepStrictEqual(mktreeEntryNames(skillTreeCall).sort(), ['cursors.json', 'retry-queue.json', 'runs.json']);
});
