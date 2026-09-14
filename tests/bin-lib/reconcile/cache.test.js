'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readCache, writeCache, isFresh, CACHE_FILENAME, DEFAULT_TTL_MS, SHARED_HEALTH_TTL_MS,
  RESIDUE_ESCALATE_THRESHOLD, recordResidueFailure, recordResidueSuccess, listResidueFailures,
  trackResidue, pruneResidueFailures,
} = require('../../../plugin/bin/lib/reconcile/cache');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-cache-'));
}

test('readCache: absent file reads as empty defaults, not a throw', () => {
  const root = tmpRoot();
  assert.deepEqual(readCache(root), {
    lastRunAt: null, claimShas: {}, residueFailures: {}, lastHealthCheckOkAt: null,
  });
});

test('readCache: corrupt JSON fails closed to empty defaults, not a throw', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', CACHE_FILENAME), '{not json');
  assert.deepEqual(readCache(root), {
    lastRunAt: null, claimShas: {}, residueFailures: {}, lastHealthCheckOkAt: null,
  });
});

test('writeCache then readCache round-trips', () => {
  const root = tmpRoot();
  writeCache(root, {
    lastRunAt: 12345, claimShas: { 7: 'abc' }, residueFailures: {}, lastHealthCheckOkAt: 999,
  });
  assert.deepEqual(readCache(root), {
    lastRunAt: 12345, claimShas: { 7: 'abc' }, residueFailures: {}, lastHealthCheckOkAt: 999,
  });
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
