'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readCache, writeCache, isFresh, CACHE_FILENAME, DEFAULT_TTL_MS, SHARED_HEALTH_TTL_MS,
  RESIDUE_ESCALATE_THRESHOLD, recordResidueFailure, recordResidueSuccess, listResidueFailures,
  trackResidue, pruneResidueFailures, clearResidue, beginCacheBatch, commitCacheBatch, recordResidueError, planClear,
  applyOwnerlessNonClean, applyRunDispositions,
} = require('../../../plugin/bin/lib/reconcile/cache');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-cache-'));
}

test('readCache: absent file reads as empty defaults, not a throw', () => {
  const root = tmpRoot();
  assert.deepEqual(readCache(root), {
    lastRunAt: null, claimShas: {}, residueFailures: {}, lastHealthCheckOkAt: null,
    lastOriginHeadRepairFailedAt: null, prStates: {}, claimBlobs: {}, residueIssueIndex: {},
  });
});

test('readCache: corrupt JSON fails closed to empty defaults, not a throw', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', CACHE_FILENAME), '{not json');
  assert.deepEqual(readCache(root), {
    lastRunAt: null, claimShas: {}, residueFailures: {}, lastHealthCheckOkAt: null,
    lastOriginHeadRepairFailedAt: null, prStates: {}, claimBlobs: {}, residueIssueIndex: {},
  });
});

test('writeCache then readCache round-trips', () => {
  const root = tmpRoot();
  writeCache(root, {
    lastRunAt: 12345, claimShas: { 7: 'abc' }, residueFailures: {}, lastHealthCheckOkAt: 999,
    lastOriginHeadRepairFailedAt: 4242, prStates: { 'n:1': { v: 'pr-not-found', at: 5 } },
    claimBlobs: { s1: '{"runId":"r"}' }, residueIssueIndex: { 'o/r\nm': 7 },
  });
  assert.deepEqual(readCache(root), {
    lastRunAt: 12345, claimShas: { 7: 'abc' }, residueFailures: {}, lastHealthCheckOkAt: 999,
    lastOriginHeadRepairFailedAt: 4242, prStates: { 'n:1': { v: 'pr-not-found', at: 5 } },
    claimBlobs: { s1: '{"runId":"r"}' }, residueIssueIndex: { 'o/r\nm': 7 },
  });
});

test('#4421 AC6.2 AC6.3: applyOwnerlessNonClean stamps the first zero, keeps it, and clears it above zero', () => {
  const first = Date.parse('2026-10-26T00:00:00Z');
  const zero = applyOwnerlessNonClean({}, 0, first);
  assert.deepEqual(zero, { ownerlessNonClean: 0, ownerlessNonCleanZeroSince: '2026-10-26T00:00:00.000Z' });
  const kept = applyOwnerlessNonClean(zero, 0, first + 86400000);
  assert.equal(kept.ownerlessNonCleanZeroSince, '2026-10-26T00:00:00.000Z');
  const cleared = applyOwnerlessNonClean(kept, 2, first + 2 * 86400000);
  assert.deepEqual(cleared, { ownerlessNonClean: 2 });
  assert.equal('ownerlessNonCleanZeroSince' in cleared, false);
  assert.deepEqual(kept, { ownerlessNonClean: 0, ownerlessNonCleanZeroSince: '2026-10-26T00:00:00.000Z' }, 'the input is not mutated');
});

test('#4421 readCache keeps valid ownerless keys and drops invalid ones', () => {
  const root = tmpRoot();
  const valid = { ownerlessNonClean: 0, ownerlessNonCleanZeroSince: '2026-10-26T00:00:00.000Z' };
  writeCache(root, valid);
  assert.deepEqual(readCache(root), { ...readCache(tmpRoot()), ...valid });
  for (const bad of [-1, 1.5, '3', null]) {
    writeCache(root, { ownerlessNonClean: bad });
    assert.equal('ownerlessNonClean' in readCache(root), false, `ownerlessNonClean ${JSON.stringify(bad)} is dropped`);
  }
  for (const bad of ['not a date', null, 5]) {
    writeCache(root, { ownerlessNonCleanZeroSince: bad });
    assert.equal('ownerlessNonCleanZeroSince' in readCache(root), false, `ownerlessNonCleanZeroSince ${JSON.stringify(bad)} is dropped`);
  }
});

test('#3977 applyRunDispositions stamps reportOnlyPassAt and both lists', () => {
  const now = Date.parse('2026-10-26T00:00:00Z');
  const report = {
    reportOnly: true,
    wouldClose: [{ runId: 'r1', runDir: '/p/r1', reason: 'adhoc-dead', evidence: { verdict: 'dead' }, dropFindings: [] }],
    orphaned: [{ runId: 'r2', runDir: '/p/r2', reason: 'PR #4 open, session gone', pr: 4 }],
    unknown: 3,
  };
  const before = { lastRunAt: 1 };
  const next = applyRunDispositions(before, report, now);
  assert.deepEqual(next, {
    lastRunAt: 1,
    wouldClose: [{ runId: 'r1', runDir: '/p/r1', reason: 'adhoc-dead', evidence: { verdict: 'dead' } }],
    orphaned: [{ runId: 'r2', runDir: '/p/r2', reason: 'PR #4 open, session gone', pr: 4 }],
    reportOnlyPassAt: '2026-10-26T00:00:00.000Z',
  });
  assert.deepEqual(before, { lastRunAt: 1 }, 'the input is not mutated');
});

test('#3977 readCache keeps valid disposition keys and drops malformed entries', () => {
  const root = tmpRoot();
  const good = { runId: 'r1', runDir: '/p/r1', reason: 'adhoc-dead' };
  writeCache(root, { wouldClose: [good, { runId: '', reason: 'x' }, null, 'r'], orphaned: [{ runId: 'r2', reason: 7 }, { ...good, reason: 'draft PR #3, session gone', pr: 3 }], reportOnlyPassAt: '2026-10-26T00:00:00.000Z' });
  const c = readCache(root);
  assert.deepEqual(c.wouldClose, [good]);
  assert.deepEqual(c.orphaned, [{ ...good, reason: 'draft PR #3, session gone', pr: 3 }]);
  assert.equal(c.reportOnlyPassAt, '2026-10-26T00:00:00.000Z');
  writeCache(root, { wouldClose: 'x', reportOnlyPassAt: 'not a date' });
  assert.equal('wouldClose' in readCache(root), false);
  assert.equal('reportOnlyPassAt' in readCache(root), false);
});

test('readCache: a non-object claimBlobs (array, string) reads as {}', () => {
  for (const bad of [['x'], 'x', 7]) {
    const root = tmpRoot();
    writeCache(root, { claimBlobs: bad });
    assert.deepEqual(readCache(root).claimBlobs, {});
  }
});

test('readCache: a non-object residueIssueIndex (array, string) reads as {}', () => {
  for (const bad of [[1], 'x', 7]) {
    const root = tmpRoot();
    writeCache(root, { residueIssueIndex: bad });
    assert.deepEqual(readCache(root).residueIssueIndex, {});
  }
});

test('readCache: residueIssueIndex drops entries whose value is not a positive integer', () => {
  const root = tmpRoot();
  writeCache(root, { residueIssueIndex: { a: 3, b: 0, c: -1, d: 1.5, e: '4', f: null } });
  assert.deepEqual(readCache(root).residueIssueIndex, { a: 3 });
});

test('readCache: a non-object prStates (array, string) reads as {}', () => {
  for (const bad of [[1], 'x', 7]) {
    const root = tmpRoot();
    writeCache(root, { prStates: bad });
    assert.deepEqual(readCache(root).prStates, {});
  }
});

test('writeCache: a failure (unwritable dir) is swallowed, never throws', () => {
  const root = '/nonexistent-does-not-exist-820';
  assert.doesNotThrow(() => writeCache(root, { lastRunAt: 1, claimShas: {} }));
});

test('isFresh: within TTL is fresh', () => {
  assert.equal(isFresh({ lastRunAt: 1000 }, 1000 + DEFAULT_TTL_MS - 1, DEFAULT_TTL_MS), true);
});

test('isFresh: past TTL is not fresh', () => {
  assert.equal(isFresh({ lastRunAt: 1000 }, 1000 + DEFAULT_TTL_MS + 1, DEFAULT_TTL_MS), false);
});

test('isFresh: null lastRunAt (never run) is never fresh', () => {
  assert.equal(isFresh({ lastRunAt: null }, Date.now(), DEFAULT_TTL_MS), false);
});

// #873 — isFresh's `field` param generalizes beyond `lastRunAt` alone.
test('isFresh: an explicit field reads that field instead of lastRunAt', () => {
  const cache = { lastRunAt: 1000, lastHealthCheckOkAt: 5000 };
  // lastRunAt is stale but lastHealthCheckOkAt is fresh — proves the two
  // fields are read independently, not conflated.
  assert.equal(isFresh(cache, 5000 + SHARED_HEALTH_TTL_MS - 1, SHARED_HEALTH_TTL_MS, 'lastHealthCheckOkAt'), true);
  assert.equal(isFresh(cache, 5000 + SHARED_HEALTH_TTL_MS + 1, SHARED_HEALTH_TTL_MS, 'lastHealthCheckOkAt'), false);
});

test('isFresh: a field with no stamp of its own is never fresh, even when lastRunAt is', () => {
  const cache = { lastRunAt: 1000, lastHealthCheckOkAt: null };
  assert.equal(isFresh(cache, 1000, SHARED_HEALTH_TTL_MS, 'lastHealthCheckOkAt'), false);
});

// #644 Deliverable 2 — per-path consecutive-failure counter + escalation.
test('recordResidueFailure: does not escalate before the threshold', () => {
  const root = tmpRoot();
  for (let i = 1; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    const r = recordResidueFailure(root, 'move-failed', '/x/run-1', { now: 1000 + i });
    assert.equal(r.count, i);
    assert.equal(r.shouldEscalate, false, `call ${i} must not escalate yet`);
  }
});

test('recordResidueFailure: escalates exactly once, on the threshold-th call, never again while still failing', () => {
  const root = tmpRoot();
  let last;
  for (let i = 1; i <= RESIDUE_ESCALATE_THRESHOLD + 3; i++) {
    last = recordResidueFailure(root, 'removal-failed', '/x/wt-1', { now: 2000 + i });
    if (i < RESIDUE_ESCALATE_THRESHOLD) assert.equal(last.shouldEscalate, false);
    else if (i === RESIDUE_ESCALATE_THRESHOLD) assert.equal(last.shouldEscalate, true, 'must escalate on the threshold-th call');
    else assert.equal(last.shouldEscalate, false, `call ${i} (past threshold) must not re-escalate`);
  }
  assert.equal(last.count, RESIDUE_ESCALATE_THRESHOLD + 3);
});

test('recordResidueSuccess: resets the counter to zero — a later failure starts a fresh streak (and can re-escalate)', () => {
  const root = tmpRoot();
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) recordResidueFailure(root, 'move-failed', '/x/run-2', { now: 3000 + i });
  recordResidueSuccess(root, 'move-failed', '/x/run-2');
  assert.deepEqual(listResidueFailures(root), []);

  const afterReset = recordResidueFailure(root, 'move-failed', '/x/run-2', { now: 9000 });
  assert.equal(afterReset.count, 1);
  assert.equal(afterReset.shouldEscalate, false);

  // afterReset already used up the 1st of RESIDUE_ESCALATE_THRESHOLD
  // failures needed to re-escalate — (threshold - 2) more calls land just
  // short of the threshold, and the final call is the threshold-th.
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD - 2; i++) {
    const r = recordResidueFailure(root, 'move-failed', '/x/run-2', { now: 9000 + i + 1 });
    assert.equal(r.shouldEscalate, false, `pre-threshold call ${i} must not escalate`);
  }
  const reEscalated = recordResidueFailure(root, 'move-failed', '/x/run-2', { now: 9999 });
  assert.equal(reEscalated.count, RESIDUE_ESCALATE_THRESHOLD);
  assert.equal(reEscalated.shouldEscalate, true, 're-failing after a success must be able to escalate again');
});

test('recordResidueSuccess: a no-op on a path with no tracked failure never throws', () => {
  const root = tmpRoot();
  assert.doesNotThrow(() => recordResidueSuccess(root, 'move-failed', '/never/failed'));
});

test('listResidueFailures: splits the composite key back into reason and path', () => {
  const root = tmpRoot();
  recordResidueFailure(root, 'move-failed', '/x/run-3', { now: 1 });
  const [entry] = listResidueFailures(root);
  assert.equal(entry.reason, 'move-failed');
  assert.equal(entry.path, '/x/run-3');
  assert.equal(entry.count, 1);
  assert.equal(entry.firstFailedAt, 1);
});

test('recordResidueFailure: independent counters for the same path under different reasons', () => {
  const root = tmpRoot();
  recordResidueFailure(root, 'move-failed', '/x/shared', { now: 1 });
  recordResidueFailure(root, 'removal-failed', '/x/shared', { now: 1 });
  const entries = listResidueFailures(root);
  assert.equal(entries.length, 2);
});

// #1796 Deliverable 2 — dirtyFiles is refreshed (never merged/accumulated)
// on every failure, and dropped entirely once the streak resets on success.
test('recordResidueFailure: dirtyFiles is persisted and replaced per failure, cleared on success', () => {
  const root = tmpRoot();
  recordResidueFailure(root, 'removal-failed', '/x/wt', { now: 1, dirtyFiles: ['?? a.txt'] });
  let [entry] = listResidueFailures(root);
  assert.deepEqual(entry.dirtyFiles, ['?? a.txt']);

  // A later failure with a DIFFERENT (or null) dirtyFiles value overwrites,
  // it never merges with the prior list.
  recordResidueFailure(root, 'removal-failed', '/x/wt', { now: 2, dirtyFiles: null });
  [entry] = listResidueFailures(root);
  assert.equal(entry.dirtyFiles, null, 'a fresh null read must overwrite the prior list, not keep it');

  recordResidueFailure(root, 'removal-failed', '/x/wt', { now: 3, dirtyFiles: ['?? b.txt', '?? c.txt'] });
  [entry] = listResidueFailures(root);
  assert.deepEqual(entry.dirtyFiles, ['?? b.txt', '?? c.txt']);

  recordResidueSuccess(root, 'removal-failed', '/x/wt');
  assert.deepEqual(listResidueFailures(root), [], 'success clears the whole entry, dirtyFiles included');
});

// #1233 — trackResidue is the shared success/fail branch-into-cache-helpers
// helper both reap-merged.js's trackReapResidue and archive-merged.js's
// trackArchiveResult now call instead of duplicating it. Covers escalate-on-
// threshold behavior for both reason strings the two call sites use.
test('trackResidue: escalates exactly once at the threshold via an injected escalate, never on later still-failing calls (removal-failed)', () => {
  const root = tmpRoot();
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };

  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackResidue(root, 'o/r', 'removal-failed', '/x/wt', { failed: true, lastError: 'x' }, { escalate });
  }
  assert.equal(calls.length, 1, `expected exactly one escalation call, got ${calls.length}`);
  assert.equal(calls[0].reason, 'removal-failed');
  assert.equal(calls[0].targetPath, '/x/wt');
  assert.equal(calls[0].count, RESIDUE_ESCALATE_THRESHOLD);

  trackResidue(root, 'o/r', 'removal-failed', '/x/wt', { failed: true, lastError: 'x' }, { escalate });
  assert.equal(calls.length, 1, 'must not re-escalate on a later still-failing call');
});

// #1796 — the escalate call at threshold must carry the most recent
// dirtyFiles reading through, so the filed issue's body can render it.
test('trackResidue: threads dirtyFiles through to the escalate call', () => {
  const root = tmpRoot();
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };

  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD - 1; i++) {
    trackResidue(root, 'o/r', 'removal-failed', '/x/wt', { failed: true, lastError: 'x', dirtyFiles: ['?? stale.txt'] }, { escalate });
  }
  trackResidue(root, 'o/r', 'removal-failed', '/x/wt', { failed: true, lastError: 'x', dirtyFiles: ['?? fresh.txt'] }, { escalate });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].dirtyFiles, ['?? fresh.txt']);
});

test('trackResidue: escalates exactly once at the threshold via an injected escalate, never on later still-failing calls (move-failed)', () => {
  const root = tmpRoot();
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  const dir = path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-stuck');

  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackResidue(root, 'o/r', 'move-failed', dir, { failed: true, lastError: undefined }, { escalate });
  }
  assert.equal(calls.length, 1, `expected exactly one escalation call, got ${calls.length}`);
  assert.equal(calls[0].reason, 'move-failed');
  assert.equal(calls[0].targetPath, dir);
  assert.equal(calls[0].count, RESIDUE_ESCALATE_THRESHOLD);

  trackResidue(root, 'o/r', 'move-failed', dir, { failed: true, lastError: undefined }, { escalate });
  assert.equal(calls.length, 1, 'must not re-escalate on a later still-failing call');
});

test('trackResidue: a success clears a prior failure streak and never escalates', () => {
  const root = tmpRoot();
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };

  trackResidue(root, 'o/r', 'removal-failed', '/x/wt-success', { failed: true, lastError: 'x' }, { escalate });
  assert.equal(listResidueFailures(root).length, 1);

  trackResidue(root, 'o/r', 'removal-failed', '/x/wt-success', { failed: false }, { escalate });
  assert.deepEqual(listResidueFailures(root), []);
  assert.equal(calls.length, 0, 'a success must never escalate');
});

test('trackResidue: never throws when escalate itself throws (best-effort)', () => {
  const root = tmpRoot();
  const escalate = () => { throw new Error('gh not found'); };
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    assert.doesNotThrow(() => trackResidue(root, 'o/r', 'removal-failed', '/x/wt-throws', { failed: true, lastError: 'x' }, { escalate }));
  }
});

test('trackResidue: forwards an injected `runner` into the escalate call', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-cache-runner-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  const runner = () => '[]';
  let last;
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    last = trackResidue(root, 'o/r', 'removal-failed', '/x/wt-runner', { failed: true, lastError: 'x' }, { escalate, runner });
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runner, runner, 'the escalate call must receive the same runner reference this call was given');
});

// #4202: the predicate handed to escalate/resolve judges only this checkout's own
// run-dir tree; a path from another checkout/machine always counts as present.
function assertOwnedPathPredicate(pathExists, root) {
  assert.equal(typeof pathExists, 'function');
  const pipelines = path.join(root, '.claude-tweaks', 'pipelines');
  fs.mkdirSync(pipelines, { recursive: true });
  const present = path.join(pipelines, 'present-run');
  fs.mkdirSync(present);
  assert.equal(pathExists(path.join(pipelines, 'missing-run')), false, 'a missing path under this checkout\'s pipelines dir is gone');
  assert.equal(pathExists(present), true, 'an existing path under this checkout\'s pipelines dir is present');
  assert.equal(pathExists('/other-machine/repo/.claude-tweaks/pipelines/x'), true, 'a path outside this checkout\'s pipelines dir is never judged');
  assert.equal(pathExists(pipelines), true, 'the pipelines dir itself is never judged');
  assert.equal(pathExists('missing-run'), true, 'a relative listed path is never judged');
  assert.equal(pathExists(`${pipelines}/missing-run/../present-run`), true, 'an un-normalized listed path is never judged');
}

test('#4202 trackResidue: passes a checkout-scoped pathExists into the escalate call', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-cache-pathexists-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackResidue(root, 'o/r', 'structurally-stuck', '/x/wt-exists', { failed: true, lastError: 'x' }, { escalate });
  }
  assert.equal(calls.length, 1);
  assertOwnedPathPredicate(calls[0].pathExists, root);
});

test('trackResidue: omitting `runner` is unaffected — escalate receives runner: undefined, same as before this change', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-cache-runner-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackResidue(root, 'o/r', 'removal-failed', '/x/wt-no-runner', { failed: true, lastError: 'x' }, { escalate });
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runner, undefined);
});

// #1892 Deliverable 3 — pruneResidueFailures drops any entry whose live path
// is gone, regardless of reason (reason-agnostic by design — #1811's
// structurally-stuck prune shares this same call).
test('pruneResidueFailures: drops a non-escalated entry whose path is absent on disk, without calling resolve', () => {
  const root = tmpRoot();
  const gonePath = path.join(root, 'never-existed');
  recordResidueFailure(root, 'move-failed', gonePath, { now: 1 });
  assert.equal(listResidueFailures(root).length, 1);

  const calls = [];
  const resolve = (args) => { calls.push(args); return { status: 'closed', number: 1 }; };
  pruneResidueFailures(root, 'o/r', { resolve });

  assert.deepEqual(listResidueFailures(root), []);
  assert.equal(calls.length, 0, 'a non-escalated entry must never trigger a resolution call');
});

test('pruneResidueFailures: keeps an entry whose path still exists on disk', () => {
  const root = tmpRoot();
  const stillLivePath = fs.mkdtempSync(path.join(root, 'still-live-'));
  recordResidueFailure(root, 'move-failed', stillLivePath, { now: 1 });

  pruneResidueFailures(root, 'o/r');

  assert.equal(listResidueFailures(root).length, 1);
});

test('pruneResidueFailures: an escalated entry whose path is gone triggers exactly one resolve call, naming the reason and path, and is still dropped', () => {
  const root = tmpRoot();
  const gonePath = path.join(root, 'gone-escalated');
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    recordResidueFailure(root, 'move-failed', gonePath, { now: 100 + i });
  }
  assert.equal(listResidueFailures(root)[0].escalated, true);

  const calls = [];
  const resolve = (args) => { calls.push(args); return { status: 'closed', number: 7 }; };
  pruneResidueFailures(root, 'o/r', { resolve });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].repo, 'o/r');
  assert.equal(calls[0].reason, 'move-failed');
  assert.equal(calls[0].targetPath, gonePath);
  assert.deepEqual(listResidueFailures(root), []);
});

test('pruneResidueFailures: a resolve failure (gh absent / network) still drops the cache entry, never throws', () => {
  const root = tmpRoot();
  const gonePath = path.join(root, 'gone-resolve-fails');
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    recordResidueFailure(root, 'move-failed', gonePath, { now: 200 + i });
  }
  const resolve = () => { throw new Error('gh not found'); };
  assert.doesNotThrow(() => pruneResidueFailures(root, 'o/r', { resolve }));
  assert.deepEqual(listResidueFailures(root), []);
});

test('pruneResidueFailures: reason-agnostic — a structurally-stuck entry whose path is gone is pruned the same way', () => {
  const root = tmpRoot();
  const gonePath = path.join(root, 'gone-stuck');
  recordResidueFailure(root, 'structurally-stuck', gonePath, { now: 1 });

  pruneResidueFailures(root, 'o/r');

  assert.deepEqual(listResidueFailures(root), []);
});

test('pruneResidueFailures: forwards an injected `runner` into the resolve call', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-cache-prune-runner-'));
  const gonePath = path.join(root, 'gone-runner');
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    recordResidueFailure(root, 'move-failed', gonePath, { lastError: 'x' });
  }
  assert.equal(listResidueFailures(root)[0].escalated, true);
  const calls = [];
  const resolve = (args) => { calls.push(args); return { status: 'closed', number: 1 }; };
  const runner = () => '[]';
  pruneResidueFailures(root, 'o/r', { resolve, runner });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runner, runner);
});

test('#4202 pruneResidueFailures: passes a checkout-scoped pathExists into the resolve call', () => {
  const root = tmpRoot();
  const gonePath = path.join(root, 'gone-pathexists');
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    recordResidueFailure(root, 'structurally-stuck', gonePath, { lastError: 'x' });
  }
  const calls = [];
  pruneResidueFailures(root, 'o/r', { resolve: (args) => { calls.push(args); return { status: 'closed', number: 1 }; } });
  assert.equal(calls.length, 1);
  assertOwnedPathPredicate(calls[0].pathExists, root);
});

// --- #2724: clearResidue drops an escalated entry only once its GitHub
// resolution actually landed, so a failed resolve is retried on the next pass.

function escalatedEntryRoot() {
  const root = tmpRoot();
  const p = path.join(root, 'adhoc-dir');
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    recordResidueFailure(root, 'structurally-stuck', p, { lastError: 'stuck at no-pr' });
  }
  assert.equal(listResidueFailures(root)[0].escalated, true);
  return { root, p };
}

test('#2724 clearResidue: an escalated entry whose resolve returns resolution-failed is kept for the next pass', () => {
  const { root, p } = escalatedEntryRoot();
  const resolve = () => ({ status: 'resolution-failed', reason: 'boom' });
  const result = clearResidue(root, 'o/r', 'structurally-stuck', p, { resolve });
  assert.equal(result.cleared, false);
  assert.deepEqual(result.resolved, { status: 'resolution-failed', reason: 'boom' });
  assert.equal(listResidueFailures(root).length, 1);
});

test('#2724 clearResidue: an escalated entry whose resolve throws is kept', () => {
  const { root, p } = escalatedEntryRoot();
  const resolve = () => { throw new Error('gh not found'); };
  const result = clearResidue(root, 'o/r', 'structurally-stuck', p, { resolve });
  assert.deepEqual(result, { cleared: false, resolved: null });
  assert.equal(listResidueFailures(root).length, 1);
});

for (const status of ['closed', 'path-removed', 'not-found', 'already-closed']) {
  test(`#2724 clearResidue: an escalated entry is cleared when resolve returns ${status}`, () => {
    const { root, p } = escalatedEntryRoot();
    const resolve = () => ({ status });
    const result = clearResidue(root, 'o/r', 'structurally-stuck', p, { resolve });
    assert.deepEqual(result, { cleared: true, resolved: { status } });
    assert.deepEqual(listResidueFailures(root), []);
  });
}

test('#2724 clearResidue: an unescalated entry is cleared without calling resolve', () => {
  const root = tmpRoot();
  const p = path.join(root, 'adhoc-dir');
  recordResidueFailure(root, 'structurally-stuck', p, { lastError: 'x' });
  let called = 0;
  const result = clearResidue(root, 'o/r', 'structurally-stuck', p, { resolve: () => { called++; return { status: 'closed' }; } });
  assert.deepEqual(result, { cleared: true, resolved: null });
  assert.equal(called, 0);
  assert.deepEqual(listResidueFailures(root), []);
});

test('#4202 clearResidue: passes a checkout-scoped pathExists into the resolve call', () => {
  const { root, p } = escalatedEntryRoot();
  const calls = [];
  clearResidue(root, 'o/r', 'structurally-stuck', p, { resolve: (args) => { calls.push(args); return { status: 'closed' }; } });
  assert.equal(calls.length, 1);
  assertOwnedPathPredicate(calls[0].pathExists, root);
});

test('#2724 clearResidue: no entry returns cleared:false and writes nothing', () => {
  const root = tmpRoot();
  const result = clearResidue(root, 'o/r', 'structurally-stuck', path.join(root, 'nope'), { resolve: () => { throw new Error('must not run'); } });
  assert.deepEqual(result, { cleared: false, resolved: null });
  assert.equal(fs.existsSync(path.join(root, '.claude-tweaks', CACHE_FILENAME)), false);
});

test('#2724 clearResidue: through a cache batch, the entry is dropped on commit only after a successful resolve', () => {
  const { root, p } = escalatedEntryRoot();
  const failing = beginCacheBatch(root);
  clearResidue(failing, 'o/r', 'structurally-stuck', p, { resolve: () => ({ status: 'resolution-failed' }) });
  commitCacheBatch(failing);
  assert.equal(listResidueFailures(root).length, 1);

  const succeeding = beginCacheBatch(root);
  const result = clearResidue(succeeding, 'o/r', 'structurally-stuck', p, { resolve: () => ({ status: 'path-removed' }) });
  assert.equal(result.cleared, true);
  commitCacheBatch(succeeding);
  assert.deepEqual(listResidueFailures(root), []);
});

// #4180: one recorded reason for a swallowed escalate/resolve failure.

function escalatedStuckRoot() {
  const root = tmpRoot();
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) recordResidueFailure(root, 'structurally-stuck', '/x/p', { lastError: 'stuck at no-branch' });
  return root;
}

test('#4180 AC2.1 clearResidue: a resolution-failed resolve leaves its reason on the kept entry', () => {
  const root = escalatedStuckRoot();
  const r = clearResidue(root, 'o/r', 'structurally-stuck', '/x/p', { resolve: () => ({ status: 'resolution-failed', reason: 'HTTP 502' }) });
  assert.deepEqual(r, { cleared: false, resolved: { status: 'resolution-failed', reason: 'HTTP 502' } });
  const [e] = listResidueFailures(root);
  assert.equal(e.lastResidueError.op, 'resolve');
  assert.equal(e.lastResidueError.reason, 'HTTP 502');
  assert.equal(typeof e.lastResidueError.at, 'number');
});

test('#4180 clearResidue: an unexpected status without a reason records `status <status>`', () => {
  const root = escalatedStuckRoot();
  clearResidue(root, 'o/r', 'structurally-stuck', '/x/p', { resolve: () => ({ status: 'weird' }) });
  assert.equal(listResidueFailures(root)[0].lastResidueError.reason, 'status weird');
});

test('#4180 clearResidue: a falsy result records `no result`', () => {
  const root = escalatedStuckRoot();
  const r = clearResidue(root, 'o/r', 'structurally-stuck', '/x/p', { resolve: () => null });
  assert.deepEqual(r, { cleared: false, resolved: null });
  assert.equal(listResidueFailures(root)[0].lastResidueError.reason, 'no result');
});

test('#4180 clearResidue: a resolve that throws records the thrown message', () => {
  const root = escalatedStuckRoot();
  const r = clearResidue(root, 'o/r', 'structurally-stuck', '/x/p', { resolve: () => { throw new Error('gh: not found'); } });
  assert.deepEqual(r, { cleared: false, resolved: null });
  const [e] = listResidueFailures(root);
  assert.equal(e.lastResidueError.op, 'resolve');
  assert.equal(e.lastResidueError.reason, 'gh: not found');
  assert.equal(typeof e.lastResidueError.at, 'number');
});

test('#4180 clearResidue: a resolved status records no error', () => {
  const root = escalatedStuckRoot();
  clearResidue(root, 'o/r', 'structurally-stuck', '/x/p', { resolve: () => ({ status: 'closed' }) });
  assert.deepEqual(listResidueFailures(root), []);
});

function almostEscalatedRoot() {
  const root = tmpRoot();
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD - 1; i++) recordResidueFailure(root, 'move-failed', '/x/m', { lastError: 'EBUSY' });
  return root;
}

test('#4180 trackResidue: an escalation-failed escalate records op escalate and its reason; escalated stays true', () => {
  const root = almostEscalatedRoot();
  trackResidue(root, 'o/r', 'move-failed', '/x/m', { failed: true, lastError: 'EBUSY' }, { escalate: () => ({ status: 'escalation-failed', reason: 'rate limited' }) });
  const [e] = listResidueFailures(root);
  assert.equal(e.escalated, true);
  assert.equal(e.lastResidueError.op, 'escalate');
  assert.equal(e.lastResidueError.reason, 'rate limited');
  assert.equal(typeof e.lastResidueError.at, 'number');
});

test('#4180 trackResidue: an escalate that throws records the thrown message', () => {
  const root = almostEscalatedRoot();
  assert.doesNotThrow(() => trackResidue(root, 'o/r', 'move-failed', '/x/m', { failed: true, lastError: 'EBUSY' }, { escalate: () => { throw new Error('boom'); } }));
  const [e] = listResidueFailures(root);
  assert.equal(e.escalated, true);
  assert.equal(e.lastResidueError.op, 'escalate');
  assert.equal(e.lastResidueError.reason, 'boom');
});

test('#4180 trackResidue: a successful escalate records no error', () => {
  const root = almostEscalatedRoot();
  trackResidue(root, 'o/r', 'move-failed', '/x/m', { failed: true, lastError: 'EBUSY' }, { escalate: () => ({ status: 'filed', number: 9 }) });
  const [e] = listResidueFailures(root);
  assert.equal(e.escalated, true);
  assert.equal('lastResidueError' in e, false);
});

test('#4180 trackResidue: an escalate failure recorded through a cache batch lands on commit', () => {
  const root = almostEscalatedRoot();
  const batch = beginCacheBatch(root);
  trackResidue(batch, 'o/r', 'move-failed', '/x/m', { failed: true, lastError: 'EBUSY' }, { escalate: () => ({ status: 'escalation-failed', reason: 'rate limited' }) });
  assert.equal('lastResidueError' in listResidueFailures(root)[0], false);
  commitCacheBatch(batch);
  assert.equal(listResidueFailures(root)[0].lastResidueError.reason, 'rate limited');
});

test('#4180 a later success drops the entry and its lastResidueError together', () => {
  const root = escalatedStuckRoot();
  clearResidue(root, 'o/r', 'structurally-stuck', '/x/p', { resolve: () => ({ status: 'resolution-failed', reason: 'HTTP 502' }) });
  assert.equal(listResidueFailures(root)[0].lastResidueError.reason, 'HTTP 502');
  clearResidue(root, 'o/r', 'structurally-stuck', '/x/p', { resolve: () => ({ status: 'closed' }) });
  assert.deepEqual(listResidueFailures(root), []);
});

test('#4180 pruneResidueFailures: returns resolve failures for gone escalated paths and still drops the entries', () => {
  const root = tmpRoot();
  const gonePath = path.join(root, 'gone');
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) recordResidueFailure(root, 'move-failed', gonePath, { lastError: 'EBUSY' });
  const out = pruneResidueFailures(root, 'o/r', { resolve: () => ({ status: 'resolution-failed', reason: 'HTTP 500' }) });
  assert.deepEqual(out, { failures: [{ reason: 'move-failed', path: gonePath, op: 'resolve', error: 'HTTP 500' }] });
  assert.deepEqual(listResidueFailures(root), []);
});

test('#4180 pruneResidueFailures: a throwing resolve is a failure with the thrown message; a resolved or unescalated gone path is not', () => {
  const root = tmpRoot();
  const thrown = path.join(root, 'gone-throw');
  const closed = path.join(root, 'gone-closed');
  const unescalated = path.join(root, 'gone-unescalated');
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    recordResidueFailure(root, 'move-failed', thrown, { lastError: 'x' });
    recordResidueFailure(root, 'move-failed', closed, { lastError: 'x' });
  }
  recordResidueFailure(root, 'move-failed', unescalated, { lastError: 'x' });
  const out = pruneResidueFailures(root, 'o/r', {
    resolve: ({ targetPath }) => {
      if (targetPath === thrown) throw new Error('gh: down');
      return { status: 'closed' };
    },
  });
  assert.deepEqual(out, { failures: [{ reason: 'move-failed', path: thrown, op: 'resolve', error: 'gh: down' }] });
  assert.deepEqual(listResidueFailures(root), []);
});

test('#4180 pruneResidueFailures: nothing to prune returns an empty failures list', () => {
  const root = tmpRoot();
  assert.deepEqual(pruneResidueFailures(root, 'o/r', { resolve: () => { throw new Error('must not run'); } }), { failures: [] });
});

test('#4180 recordResidueError: a no-op when the entry does not exist', () => {
  const root = tmpRoot();
  recordResidueError(root, 'move-failed', '/x/none', { op: 'resolve', error: 'x' });
  assert.deepEqual(listResidueFailures(root), []);
  assert.equal(fs.existsSync(path.join(root, '.claude-tweaks', CACHE_FILENAME)), false);
});

test('#4180 recordResidueError: sets lastResidueError on an existing entry', () => {
  const root = tmpRoot();
  recordResidueFailure(root, 'move-failed', '/x/m', { lastError: 'EBUSY' });
  recordResidueError(root, 'move-failed', '/x/m', { op: 'escalate', error: 'nope', now: 1234 });
  assert.deepEqual(listResidueFailures(root)[0].lastResidueError, { op: 'escalate', reason: 'nope', at: 1234 });
});

test('#4180 recordResidueError: a multi-line gh failure is stored as one line capped at 200 characters', () => {
  const root = tmpRoot();
  recordResidueFailure(root, 'move-failed', '/x/m', { lastError: 'EBUSY' });
  recordResidueError(root, 'move-failed', '/x/m', { op: 'escalate', error: `Command failed: gh issue create\n${'HTTP 502\n'.repeat(100)}` });
  const stored = listResidueFailures(root)[0].lastResidueError.reason;
  assert.equal(stored.length, 200);
  assert.ok(!/\s{2}|\n/.test(stored));
  assert.ok(stored.startsWith('Command failed: gh issue create HTTP 502'));
});

test('#4180 pruneResidueFailures: a long multi-line resolve failure is returned as one capped line', () => {
  const root = tmpRoot();
  const gonePath = path.join(root, 'gone');
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) recordResidueFailure(root, 'move-failed', gonePath, { lastError: 'EBUSY' });
  const out = pruneResidueFailures(root, 'o/r', { resolve: () => ({ status: 'resolution-failed', reason: `a\n${'b'.repeat(500)}` }) });
  assert.equal(out.failures[0].error.length, 200);
  assert.ok(!out.failures[0].error.includes('\n'));
});

test('#4180 recordResidueError: through a cache batch, lands on commit', () => {
  const root = tmpRoot();
  const batch = beginCacheBatch(root);
  recordResidueFailure(batch, 'move-failed', '/x/m', { lastError: 'EBUSY' });
  recordResidueError(batch, 'move-failed', '/x/m', { op: 'resolve', error: 'nope', now: 5 });
  assert.deepEqual(listResidueFailures(root), []);
  commitCacheBatch(batch);
  assert.deepEqual(listResidueFailures(root)[0].lastResidueError, { op: 'resolve', reason: 'nope', at: 5 });
});

test('#4180 recordResidueFailure carries lastResidueError forward on the next failing pass', () => {
  const root = almostEscalatedRoot();
  trackResidue(root, 'o/r', 'move-failed', '/x/m', { failed: true, lastError: 'EBUSY' }, { escalate: () => ({ status: 'escalation-failed', reason: 'rate limited' }) });
  const before = listResidueFailures(root)[0].lastResidueError;
  assert.equal(before.op, 'escalate');
  const streak = recordResidueFailure(root, 'move-failed', '/x/m', { lastError: 'EBUSY again' });
  assert.equal(streak.shouldEscalate, false);
  const [e] = listResidueFailures(root);
  assert.equal(e.count, RESIDUE_ESCALATE_THRESHOLD + 1);
  assert.deepEqual(e.lastResidueError, before);
});

const cacheBytes = (root) => fs.readFileSync(path.join(root, '.claude-tweaks', CACHE_FILENAME));

test('#4180 dry-run trackResidue: past threshold plans would-escalate, calls no escalate, writes nothing', () => {
  const root = almostEscalatedRoot();
  const before = cacheBytes(root);
  let calls = 0;
  const plan = trackResidue(root, 'o/r', 'move-failed', '/x/m', { failed: true, lastError: 'e' }, { escalate: () => { calls++; }, dryRun: true });
  assert.deepEqual(plan, { action: 'would-escalate', reason: 'move-failed', path: '/x/m', count: RESIDUE_ESCALATE_THRESHOLD });
  assert.equal(calls, 0);
  assert.deepEqual(cacheBytes(root), before);
});

test('#4180 dry-run trackResidue: below threshold plans would-track; success with an entry plans would-clear; success without plans none', () => {
  const root = tmpRoot();
  const noEscalate = () => { throw new Error('must not escalate'); };
  assert.deepEqual(
    trackResidue(root, 'o/r', 'move-failed', '/x/m', { failed: true, lastError: 'e' }, { escalate: noEscalate, dryRun: true }),
    { action: 'would-track', reason: 'move-failed', path: '/x/m', count: 1 },
  );
  assert.equal(fs.existsSync(path.join(root, '.claude-tweaks', CACHE_FILENAME)), false);
  assert.deepEqual(
    trackResidue(root, 'o/r', 'move-failed', '/x/m', { failed: false }, { dryRun: true }),
    { action: 'none', reason: 'move-failed', path: '/x/m' },
  );
  recordResidueFailure(root, 'move-failed', '/x/m', { lastError: 'EBUSY' });
  const before = cacheBytes(root);
  assert.deepEqual(
    trackResidue(root, 'o/r', 'move-failed', '/x/m', { failed: false }, { dryRun: true }),
    { action: 'would-clear', reason: 'move-failed', path: '/x/m' },
  );
  assert.deepEqual(cacheBytes(root), before);
});

test('#4180 dry-run trackResidue: an already-escalated entry past threshold plans would-track, not a second escalation', () => {
  const root = tmpRoot();
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) recordResidueFailure(root, 'move-failed', '/x/m', { lastError: 'EBUSY' });
  const plan = trackResidue(root, 'o/r', 'move-failed', '/x/m', { failed: true }, { dryRun: true });
  assert.deepEqual(plan, { action: 'would-track', reason: 'move-failed', path: '/x/m', count: RESIDUE_ESCALATE_THRESHOLD + 1 });
});

test('#4180 dry-run trackResidue reads an existing batch entry', () => {
  const root = tmpRoot();
  const batch = beginCacheBatch(root);
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD - 1; i++) recordResidueFailure(batch, 'move-failed', '/x/m', { lastError: 'EBUSY' });
  const cacheBefore = batch.cache;
  const plan = trackResidue(batch, 'o/r', 'move-failed', '/x/m', { failed: true }, { escalate: () => { throw new Error('must not escalate'); }, dryRun: true });
  assert.equal(plan.action, 'would-escalate');
  assert.equal(plan.count, RESIDUE_ESCALATE_THRESHOLD);
  assert.equal(batch.cache, cacheBefore);
  assert.equal(batch.cache.residueFailures['move-failed:/x/m'].count, RESIDUE_ESCALATE_THRESHOLD - 1);
});

test('#4180 dry-run trackResidue: a batch that was never dirtied stays clean', () => {
  const root = tmpRoot();
  const batch = beginCacheBatch(root);
  trackResidue(batch, 'o/r', 'move-failed', '/x/m', { failed: true }, { dryRun: true });
  assert.equal(batch.dirty, false);
});

test('#4180 commitCacheBatch: dryRun never writes a dirty batch', () => {
  const root = tmpRoot();
  const batch = beginCacheBatch(root);
  recordResidueFailure(batch, 'move-failed', '/x/m', { lastError: 'EBUSY' });
  assert.equal(batch.dirty, true);
  commitCacheBatch(batch, { dryRun: true });
  assert.equal(fs.existsSync(path.join(root, '.claude-tweaks', CACHE_FILENAME)), false);
  commitCacheBatch(batch);
  assert.equal(listResidueFailures(root).length, 1);
});

test('#4180 planClear: escalated entry plans would-resolve, unescalated would-clear, absent none; reads only', () => {
  const root = tmpRoot();
  assert.deepEqual(planClear(root, 'move-failed', '/x/m'), { action: 'none', reason: 'move-failed', path: '/x/m' });
  assert.equal(fs.existsSync(path.join(root, '.claude-tweaks', CACHE_FILENAME)), false);
  recordResidueFailure(root, 'move-failed', '/x/m', { lastError: 'EBUSY' });
  assert.deepEqual(planClear(root, 'move-failed', '/x/m'), { action: 'would-clear', reason: 'move-failed', path: '/x/m' });
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) recordResidueFailure(root, 'move-failed', '/x/m', { lastError: 'EBUSY' });
  const before = cacheBytes(root);
  assert.deepEqual(planClear(root, 'move-failed', '/x/m'), { action: 'would-resolve', reason: 'move-failed', path: '/x/m' });
  assert.deepEqual(cacheBytes(root), before);
  const batch = beginCacheBatch(root);
  assert.equal(planClear(batch, 'move-failed', '/x/m').action, 'would-resolve');
});
