'use strict';
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
// eagerly while the script array literal is being built. ---

function fakeRunner(script) {
  const calls = [];
  function run(cmd, args, opts) {
    calls.push({ cmd, args, opts });
    for (const rule of script) {
      if (rule.match(cmd, args)) {
        const throwsVal = typeof rule.throws === 'function' ? rule.throws(cmd, args) : rule.throws;
        if (throwsVal) throw new Error(throwsVal);
        return typeof rule.returns === 'function' ? rule.returns(cmd, args) : rule.returns;
      }
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

test('readState parses each file via git show, defaulting missing files to {}/[]', () => {
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
  const g = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-state-z-'));
  try {
    const origin = path.join(dir, 'origin.git');
    const clone = path.join(dir, 'clone');
    g(['init', '--bare', '-q', '-b', 'main', origin]);
    g(['clone', '-q', origin, clone]);
    g(['-C', clone, 'config', 'user.email', 'test@example.com']);
    g(['-C', clone, 'config', 'user.name', 'Test']);
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

test('readState parses declined.json via git show for a skill that opts in, defaulting to {} when missing', () => {
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
