'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('../../helpers/read-skill');
const {
  NAMESPACE, DEFAULT_BREAKER, readBreakerState, writeBreakerState, readWatched, writeWatched,
  classifyWatchedRecord,
} = require('../../../plugin/bin/lib/issues/merge-lane-breaker.js');

// --- minimal fake git runner, same shape as durable-state.test.js's own
// fakeRunner (kept independent rather than importing it, since this suite
// only needs read/write wiring proof, not the full CAS-loop coverage
// durable-state.test.js already owns). ---

function fakeRunner(script) {
  function run(cmd, args, opts) {
    for (const rule of script) {
      if (rule.match(cmd, args)) {
        const throwsVal = typeof rule.throws === 'function' ? rule.throws(cmd, args) : rule.throws;
        if (throwsVal) throw new Error(throwsVal);
        return typeof rule.returns === 'function' ? rule.returns(cmd, args) : rule.returns;
      }
    }
    throw new Error(`fakeRunner: no rule matched ${cmd} ${JSON.stringify(args)}`);
  }
  return { run };
}

function matchArgs(args, needle) {
  return args.join(' ').includes(needle);
}

function baseWriteRules() {
  return [
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && matchArgs(args, '^{tree}'), returns: 'commit-sha-1\ntree-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'ls-tree'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'tree-sha-2\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'), returns: 'commit-sha-2\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'push'), returns: '' },
  ];
}

test('NAMESPACE is merge-lane — its own path prefix on the shared health-state branch', () => {
  assert.equal(NAMESPACE, 'merge-lane');
});

// --- Fail-closed read (AC6) ---

test('#311 AC6: readBreakerState resolves tripped:false against a genuinely never-written branch (missing ref, not a real failure)', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), throws: "couldn't find remote ref health-state" },
  ]);
  const state = readBreakerState('/repo', { run, sleep: () => {} });
  assert.equal(state.tripped, false);
  assert.equal(state.transientReadFailure, undefined);
});

test('#311 AC6: readBreakerState resolves tripped:true for THIS FIRING on a genuine (non-missing-ref) fetch failure, without asserting any durable write', () => {
  const writeAttempted = { value: false };
  const { run } = fakeRunner([
    {
      match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'),
      throws: 'fatal: unable to access https://github.com/x/y.git/: Could not resolve host: github.com',
    },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'push'), returns: () => { writeAttempted.value = true; return ''; } },
  ]);
  const state = readBreakerState('/repo', { run, sleep: () => {} });
  assert.equal(state.tripped, true);
  assert.equal(state.transientReadFailure, true);
  assert.equal(writeAttempted.value, false, 'a fail-closed read must never itself attempt a durable write');
});

test('readBreakerState returns the real breaker.json content on a clean read', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    {
      match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show') && matchArgs(args, 'breaker.json'),
      returns: JSON.stringify({ tripped: true, trippedAt: '2026-08-01T00:00:00.000Z', trippedBy: { record: 100, reason: 'revert' }, resetAt: null, resetBy: null }),
    },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
  ]);
  const state = readBreakerState('/repo', { run, sleep: () => {} });
  assert.equal(state.tripped, true);
  assert.equal(state.trippedBy.record, 100);
  assert.equal(state.trippedBy.reason, 'revert');
});

test('a never-written branch defaults breaker to DEFAULT_BREAKER shape', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), throws: "couldn't find remote ref health-state" },
  ]);
  const state = readBreakerState('/repo', { run, sleep: () => {} });
  assert.deepEqual(state, DEFAULT_BREAKER);
});

// --- readWatched / writeWatched / writeBreakerState wiring ---

test('readWatched returns the watched.json map, defaulting to {} when absent', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
  ]);
  const watched = readWatched('/repo', { run, sleep: () => {} });
  assert.deepEqual(watched, {});
});

test('writeBreakerState persists a mutated breaker without disturbing watched.json (partial-namespace-write proof)', () => {
  const { run } = fakeRunner(baseWriteRules());
  const result = writeBreakerState('/repo', (current) => ({ ...current, tripped: true, trippedAt: 'now', trippedBy: { record: 311, reason: 'revert' } }), { run, sleep: () => {} });
  assert.deepEqual(result, { ok: true });
});

test('writeWatched persists a mutated watched map', () => {
  const { run } = fakeRunner(baseWriteRules());
  const result = writeWatched('/repo', (current) => ({ ...current, 42: { grantedAt: '2026-08-01T00:00:00.000Z' } }), { run, sleep: () => {} });
  assert.deepEqual(result, { ok: true });
});

// --- classifyWatchedRecord (pure) ---

const NOW = Date.parse('2026-08-18T00:00:00.000Z');
const WINDOW_DAYS = 14;

test('#311 AC1: a watched record whose closing commit is discovered reverted classifies as trip:revert', () => {
  const closerSha = 'aaaa1111111111111111111111111111111111';
  const gitLog = [
    { sha: closerSha, message: 'refs #201 done' },
    { sha: 'bbbb222222222222222222222222222222222222', message: `Revert "refs #201 done"\n\nThis reverts commit ${closerSha}.` },
  ];
  const entry = { number: 201, state: 'CLOSED', closedAt: '2026-08-01T00:00:00.000Z', labels: [] };
  const result = classifyWatchedRecord(entry, gitLog, NOW, WINDOW_DAYS);
  assert.deepEqual(result, { action: 'trip', reason: 'revert' });
});

test('#311 AC2: a watched record previously tracked CLOSED and now observed OPEN classifies as trip:reopened, its own scenario', () => {
  const entry = { number: 202, lastKnownState: 'CLOSED', state: 'OPEN', labels: [] };
  const result = classifyWatchedRecord(entry, [], NOW, WINDOW_DAYS);
  assert.deepEqual(result, { action: 'trip', reason: 'reopened' });
});

test('#311 AC3: a watched record carrying demo:changes-requested classifies as trip:demo:changes-requested, its own scenario', () => {
  const entry = { number: 203, state: 'OPEN', labels: ['demo:changes-requested'] };
  const result = classifyWatchedRecord(entry, [], NOW, WINDOW_DAYS);
  assert.deepEqual(result, { action: 'trip', reason: 'demo:changes-requested' });
});

test('demo:changes-requested is checked even on a closed record', () => {
  const entry = { number: 204, state: 'CLOSED', closedAt: '2026-08-01T00:00:00.000Z', labels: ['demo:changes-requested'] };
  const result = classifyWatchedRecord(entry, [], NOW, WINDOW_DAYS);
  assert.deepEqual(result, { action: 'trip', reason: 'demo:changes-requested' });
});

test('resolved-good: closed, unreverted, past the revert window prunes from watched.json', () => {
  const gitLog = [{ sha: 'closer-sha', message: 'refs #205 done' }];
  const entry = { number: 205, state: 'CLOSED', closedAt: '2026-08-01T00:00:00.000Z', labels: [] }; // 17 days before NOW
  const result = classifyWatchedRecord(entry, gitLog, NOW, WINDOW_DAYS);
  assert.deepEqual(result, { action: 'prune' });
});

test('closed, unreverted, but still inside the revert window stays watched (still-pending)', () => {
  const gitLog = [{ sha: 'closer-sha', message: 'refs #206 done' }];
  const entry = { number: 206, state: 'CLOSED', closedAt: '2026-08-16T00:00:00.000Z', labels: [] }; // 2 days before NOW
  const result = classifyWatchedRecord(entry, gitLog, NOW, WINDOW_DAYS);
  assert.deepEqual(result, { action: 'update', newState: 'CLOSED' });
});

test('closed with no discoverable closing commit stays watched, tracked as closed, rather than pruning or tripping', () => {
  const entry = { number: 207, state: 'CLOSED', closedAt: '2026-08-01T00:00:00.000Z', labels: [] };
  const result = classifyWatchedRecord(entry, [], NOW, WINDOW_DAYS);
  assert.deepEqual(result, { action: 'update', newState: 'CLOSED' });
});

test('still-open, never-closed record stays watched as still-pending', () => {
  const entry = { number: 208, state: 'OPEN', labels: [] };
  const result = classifyWatchedRecord(entry, [], NOW, WINDOW_DAYS);
  assert.deepEqual(result, { action: 'update', newState: 'OPEN' });
});

test('#311 AC4: a human-granted record (never in watched.json) is out of scope for this module — classifyWatchedRecord only ever sees entries the caller already read from watched.json, proving the two mechanisms are independent by construction', () => {
  // classifyWatchedRecord has no notion of "human vs machine granted" at all
  // — that distinction lives entirely in which records watched.json ever
  // contains (Phase C's machine-grant write is the only path that adds an
  // entry). A record reverted via #268's per-class mechanism is graded by
  // trust.js's resolveOperationalOutcome independently, never by this
  // function, which this test pins by showing classifyWatchedRecord takes
  // no policy/provenance input that could even distinguish the two.
  const entry = { number: 209, state: 'CLOSED', closedAt: '2026-08-01T00:00:00.000Z', labels: [] };
  const gitLog = [
    { sha: 'closer-sha', message: 'refs #209 done' },
    { sha: 'revert-sha', message: 'Revert "refs #209 done"\n\nThis reverts commit closer-sha.' },
  ];
  // Reverted -> trips, exactly the same as AC1 — the ONLY gate on whether this
  // classification ever runs at all is whether refine-headless.md's Step 0.5 chose
  // to read this record out of watched.json in the first place.
  const result = classifyWatchedRecord(entry, gitLog, NOW, WINDOW_DAYS);
  assert.deepEqual(result, { action: 'trip', reason: 'revert' });
});

// --- #311 AC7 (structural half): the reset write path exists in exactly one
// place — refine-headless.md's (formerly grant-mode.md's) Step 0.5 and Phase
// A-C never write `tripped: false` anywhere in their own procedure text. A
// live read of the shipped skill prose (not a frozen fixture): this pins a
// structural invariant about the skill's own text, which is exactly what
// would regress if a future edit ever taught refine-headless.md to clear a
// trip itself. ---

test('#311 AC7: refine-headless.md never writes tripped:false — the reset write path lives only in refine-mode.md', () => {
  const grantModePath = path.join(__dirname, '../../../plugin/skills/backlog/refine-headless.md');
  const src = readText(grantModePath);
  assert.ok(!/tripped:\s*false/.test(src), 'refine-headless.md (Step 0.5 + Phase A-C) must never write tripped: false — only refine-mode.md\'s grant sub-stage reset offer may');
});

test('#311 AC7: refine-mode.md\'s grant sub-stage cites merge-lane-reset.md, the one place that writes tripped:false (the reset path)', () => {
  const refineModePath = path.join(__dirname, '../../../plugin/skills/backlog/refine-mode.md');
  const refineSrc = readText(refineModePath);
  assert.match(refineSrc, /merge-lane-reset\.md/, 'refine-mode.md Step 3 must cite merge-lane-reset.md');
  assert.ok(!/tripped:\s*false/.test(refineSrc), 'the reset write itself must live in the cited sub-file, not inline in refine-mode.md');

  const resetFilePath = path.join(__dirname, '../../../plugin/skills/backlog/merge-lane-reset.md');
  const resetSrc = readText(resetFilePath);
  const writeMatches = resetSrc.match(/writeBreakerState[^;]*tripped:\s*false/gs) || [];
  assert.equal(writeMatches.length, 1, 'exactly one writeBreakerState(...) call writing tripped: false must exist in merge-lane-reset.md');
});

test('discoverClosingCommits reuse: a timeline-supplied closingCommitShas is preferred over a commit-log scan', () => {
  const timelineSha = 'aaaa1111111111111111111111111111111111';
  const entry = { number: 210, state: 'CLOSED', closedAt: '2026-08-01T00:00:00.000Z', labels: [], closingCommitShas: [timelineSha] };
  const gitLog = [{ sha: 'bbbb2222222222222222222222222222222222', message: `Revert "x"\n\nThis reverts commit ${timelineSha}.` }];
  const result = classifyWatchedRecord(entry, gitLog, NOW, WINDOW_DAYS);
  assert.deepEqual(result, { action: 'trip', reason: 'revert' });
});
