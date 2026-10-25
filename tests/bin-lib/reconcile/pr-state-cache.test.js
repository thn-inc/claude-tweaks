'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createPrStateResolver, persistableTtl, PR_STATE_RETENTION_MS: RET, NO_PR_TTL_MS,
} = require('../../../plugin/bin/lib/reconcile/pr-state-cache');
const { readCache, writeCache } = require('../../../plugin/bin/lib/reconcile/cache');

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-pr-state-cache-'));
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  return root;
}

const MERGED = (n) => ({ number: n, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', mergeCommit: 'abc' });
const OPEN = (n) => ({ number: n, state: 'OPEN', mergedAt: null, updatedAt: '2026-01-01T00:00:00Z', mergeCommit: null });

// Fake deps that count calls per method; `answers` maps method -> fn(arg) | value.
function fakeDeps(answers = {}) {
  const calls = { byNumber: 0, byBranch: 0, byNumberAsync: 0, byBranchAsync: 0 };
  const deps = {};
  for (const m of Object.keys(calls)) {
    deps[m] = (arg) => {
      calls[m] += 1;
      const a = answers[m];
      return typeof a === 'function' ? a(arg) : a;
    };
  }
  return { deps, calls };
}

test('persistableTtl: MERGED and pr-not-found persist, OPEN/CLOSED/failures do not', () => {
  const rows = [
    [['number', { state: 'MERGED' }], RET],
    [['number', 'pr-not-found'], RET],
    [['branch', { state: 'MERGED' }], RET],
    [['branch', null], NO_PR_TTL_MS],
    [['number', { state: 'OPEN' }], 0],
    [['number', { state: 'CLOSED' }], 0],
    [['branch', 'network-failure'], 0],
    [['number', 'gh-absent'], 0],
    [['branch', 'gh-absent'], 0],
    [['number', 'invalid-arguments'], 0],
    [['number', null], 0],
    [['branch', 'pr-not-found'], 0],
    [['branch', { state: 'OPEN' }], 0],
  ];
  for (const [[kind, value], want] of rows) {
    assert.equal(persistableTtl(kind, value), want, `${kind} ${JSON.stringify(value)}`);
  }
});

test('byNumber memoizes within a pass', () => {
  const { deps, calls } = fakeDeps({ byNumber: OPEN(5) });
  const r = createPrStateResolver({ root: tmpRoot(), deps });
  assert.deepEqual(r.byNumber(5), OPEN(5));
  assert.deepEqual(r.byNumber(5), OPEN(5));
  assert.equal(calls.byNumber, 1);
});

test('byBranch memoizes a null (no PR) answer within a pass', () => {
  const { deps, calls } = fakeDeps({ byBranch: null });
  const r = createPrStateResolver({ root: tmpRoot(), deps });
  assert.equal(r.byBranch('x'), null);
  assert.equal(r.byBranch('x'), null);
  assert.equal(calls.byBranch, 1);
});

test('a falsy branch is passed through uncached', () => {
  const { deps, calls } = fakeDeps({ byBranch: null });
  const root = tmpRoot();
  const r = createPrStateResolver({ root, deps });
  assert.equal(r.byBranch(''), null);
  assert.equal(r.byBranch(''), null);
  assert.equal(calls.byBranch, 2);
  r.persist();
  assert.deepEqual(readCache(root).prStates, {});
});

test('failure strings are not memoized', () => {
  const seq = ['network-failure', OPEN(5)];
  const { deps, calls } = fakeDeps({ byNumber: () => seq.shift() });
  const r = createPrStateResolver({ root: tmpRoot(), deps });
  assert.equal(r.byNumber(5), 'network-failure');
  assert.deepEqual(r.byNumber(5), OPEN(5));
  assert.equal(calls.byNumber, 2);
});

test('gh-absent and invalid-arguments are not memoized either; pr-not-found is', () => {
  const seq = ['gh-absent', 'invalid-arguments', 'pr-not-found'];
  const { deps, calls } = fakeDeps({ byNumber: () => seq.shift() });
  const r = createPrStateResolver({ root: tmpRoot(), deps });
  assert.equal(r.byNumber(1), 'gh-absent');
  assert.equal(r.byNumber(1), 'invalid-arguments');
  assert.equal(r.byNumber(1), 'pr-not-found');
  assert.equal(r.byNumber(1), 'pr-not-found');
  assert.equal(calls.byNumber, 3);
});

// #4032 F4: a persisted by-branch null is a cross-pass answer; a caller whose verdict flips on a
// just-opened PR (release) opts out of it per call with { freshNull: true }.
function persistedNullRoot() {
  const root = tmpRoot();
  const A = createPrStateResolver({ root, now: () => 0, deps: fakeDeps({ byBranch: null }).deps });
  A.byBranch('x');
  A.persist();
  return root;
}

test('a persisted by-branch null is served without freshNull', async () => {
  const root = persistedNullRoot();
  const { deps, calls } = fakeDeps({ byBranch: OPEN(5), byBranchAsync: OPEN(5) });
  const R = createPrStateResolver({ root, now: () => 1000, deps });
  assert.equal(R.byBranch('x'), null);
  assert.equal(await R.byBranchAsync('x'), null);
  assert.equal(calls.byBranch + calls.byBranchAsync, 0);
});

test('freshNull re-queries a persisted null live once, then serves this pass\'s memo', async () => {
  const root = persistedNullRoot();
  const { deps, calls } = fakeDeps({ byBranch: OPEN(5), byBranchAsync: OPEN(5) });
  const R = createPrStateResolver({ root, now: () => 1000, deps });
  assert.deepEqual(await R.byBranchAsync('x', { freshNull: true }), OPEN(5));
  assert.equal(calls.byBranchAsync, 1);
  // the live answer is now this pass's memo, for either flag and either twin
  assert.deepEqual(await R.byBranchAsync('x', { freshNull: true }), OPEN(5));
  assert.deepEqual(R.byBranch('x'), OPEN(5));
  assert.equal(calls.byBranchAsync + calls.byBranch, 1);

  const S = createPrStateResolver({ root, now: () => 1000, deps: fakeDeps({ byBranch: OPEN(6) }).deps });
  assert.deepEqual(S.byBranch('x', { freshNull: true }), OPEN(6), 'the sync twin honors the option too');
});

test('a null learned live in this pass still serves under freshNull', async () => {
  const root = tmpRoot();
  const { deps, calls } = fakeDeps({ byBranchAsync: null });
  const R = createPrStateResolver({ root, now: () => 0, deps });
  assert.equal(await R.byBranchAsync('y', { freshNull: true }), null);
  assert.equal(await R.byBranchAsync('y', { freshNull: true }), null);
  assert.equal(calls.byBranchAsync, 1);
});

test('prefetch with freshNull treats persisted-null keys as unknown; without it they are skipped', async () => {
  const root = persistedNullRoot();
  const plain = fakeDeps({ byBranchAsync: OPEN(5) });
  await createPrStateResolver({ root, now: () => 1000, deps: plain.deps }).prefetch({ branches: ['x'] });
  assert.equal(plain.calls.byBranchAsync, 0);

  const fresh = fakeDeps({ byBranchAsync: OPEN(5) });
  const R = createPrStateResolver({ root, now: () => 1000, deps: fresh.deps });
  await R.prefetch({ branches: ['x'], freshNull: true });
  assert.equal(fresh.calls.byBranchAsync, 1, 'the persisted null was queried live');
  assert.deepEqual(R.byBranch('x', { freshNull: true }), OPEN(5));
  assert.equal(fresh.calls.byBranch, 0);
});

test('persist then a new resolver serves MERGED without a live call', () => {
  const root = tmpRoot();
  const a = fakeDeps({ byNumber: MERGED(7), byBranch: MERGED(9) });
  const A = createPrStateResolver({ root, deps: a.deps });
  A.byNumber(7);
  A.byBranch('b');
  A.persist();

  const b = fakeDeps();
  const B = createPrStateResolver({ root, deps: b.deps });
  assert.deepEqual(B.byNumber(7), MERGED(7));
  assert.deepEqual(B.byBranch('b'), MERGED(9));
  assert.deepEqual(b.calls, { byNumber: 0, byBranch: 0, byNumberAsync: 0, byBranchAsync: 0 });
});

test('persisted pr-not-found is served to a new resolver for a number', () => {
  const root = tmpRoot();
  const A = createPrStateResolver({ root, deps: fakeDeps({ byNumber: 'pr-not-found' }).deps });
  A.byNumber(404);
  A.persist();
  const b = fakeDeps();
  assert.equal(createPrStateResolver({ root, deps: b.deps }).byNumber(404), 'pr-not-found');
  assert.equal(b.calls.byNumber, 0);
});

test('OPEN is never served from a prior pass', () => {
  const root = tmpRoot();
  const A = createPrStateResolver({ root, deps: fakeDeps({ byNumber: OPEN(8) }).deps });
  A.byNumber(8);
  A.persist();
  assert.deepEqual(readCache(root).prStates, {});

  const b = fakeDeps({ byNumber: OPEN(8) });
  createPrStateResolver({ root, deps: b.deps }).byNumber(8);
  assert.equal(b.calls.byNumber, 1);
});

test('a persisted entry whose value is no longer persistable is ignored (tampered file)', () => {
  const root = tmpRoot();
  writeCache(root, { prStates: { 'n:3': { v: OPEN(3), at: Date.now() }, 'n:4': { v: 'network-failure', at: Date.now() }, 'n:5': 'junk' } });
  const b = fakeDeps({ byNumber: OPEN(0) });
  const B = createPrStateResolver({ root, deps: b.deps });
  B.byNumber(3); B.byNumber(4); B.byNumber(5);
  assert.equal(b.calls.byNumber, 3);
});

test('a null branch answer expires after NO_PR_TTL_MS', () => {
  const root = tmpRoot();
  const A = createPrStateResolver({ root, now: () => 0, deps: fakeDeps({ byBranch: null }).deps });
  assert.equal(A.byBranch('x'), null);
  A.persist();

  const b = fakeDeps({ byBranch: null });
  const B = createPrStateResolver({ root, now: () => NO_PR_TTL_MS - 1, deps: b.deps });
  assert.equal(B.byBranch('x'), null);
  assert.equal(b.calls.byBranch, 0);

  const c = fakeDeps({ byBranch: null });
  const C = createPrStateResolver({ root, now: () => NO_PR_TTL_MS + 1, deps: c.deps });
  assert.equal(C.byBranch('x'), null);
  assert.equal(c.calls.byBranch, 1);
});

test('a future-dated entry (clock stepped back) is never served and is dropped on persist', () => {
  const root = tmpRoot();
  writeCache(root, { prStates: { 'b:x': { v: null, at: 10 * NO_PR_TTL_MS }, 'n:7': { v: MERGED(7), at: 10 * NO_PR_TTL_MS }, 'n:9': { v: MERGED(9), at: 10 * NO_PR_TTL_MS } } });
  const d = fakeDeps({ byBranch: null, byNumber: MERGED(7) });
  const r = createPrStateResolver({ root, now: () => 0, deps: d.deps });
  assert.equal(r.byBranch('x'), null);
  assert.equal(r.byNumber(7).state, 'MERGED');
  assert.equal(d.calls.byBranch, 1, 'a future-dated no-PR answer must not outlive its TTL — it is asked live');
  assert.equal(d.calls.byNumber, 1, 'a future-dated MERGED answer is not served either');
  r.persist();
  const states = readCache(root).prStates;
  assert.equal(states['b:x'].at, 0, 'the live answer replaced the future-dated one');
  assert.equal(states['n:7'].at, 0);
  assert.equal('n:9' in states, false, 'a future-dated entry nobody re-asked about is dropped, not kept past retention');
});

test('entries past retention are dropped on persist', () => {
  const root = tmpRoot();
  writeCache(root, { prStates: { 'n:1': { v: MERGED(1), at: 0 }, 'n:2': { v: MERGED(2), at: RET } } });
  const r = createPrStateResolver({ root, now: () => RET + 1, deps: fakeDeps().deps });
  r.persist();
  const states = readCache(root).prStates;
  assert.equal('n:1' in states, false);
  assert.equal('n:2' in states, true);
});

test('persist with nothing learned and nothing expired does not rewrite the file', () => {
  const root = tmpRoot();
  const file = path.join(root, '.claude-tweaks', 'reconcile-cache.json');
  createPrStateResolver({ root, deps: fakeDeps().deps }).persist();
  assert.equal(fs.existsSync(file), false);
});

test('persist merges with a concurrent writer', () => {
  const root = tmpRoot();
  const A = createPrStateResolver({ root, now: () => 1000, deps: fakeDeps({ byNumber: MERGED(1) }).deps });
  A.byNumber(1);
  const cache = readCache(root);
  writeCache(root, { ...cache, claimShas: { 9: 's' }, prStates: { 'n:2': { v: MERGED(2), at: 1000 } } });
  A.persist();
  const after = readCache(root);
  assert.deepEqual(Object.keys(after.prStates).sort(), ['n:1', 'n:2']);
  assert.deepEqual(after.claimShas, { 9: 's' });
  assert.deepEqual(after.prStates['n:1'], { v: MERGED(1), at: 1000 });
});

test('persist keeps other cache keys intact', () => {
  const root = tmpRoot();
  writeCache(root, { lastRunAt: 42, claimShas: { 3: 'x' }, residueFailures: { 'k:p': { count: 1 } }, lastHealthCheckOkAt: 7, lastOriginHeadRepairFailedAt: 8 });
  const A = createPrStateResolver({ root, deps: fakeDeps({ byBranch: MERGED(2) }).deps });
  A.byBranch('feat');
  A.persist();
  const after = readCache(root);
  assert.equal(after.lastRunAt, 42);
  assert.deepEqual(after.claimShas, { 3: 'x' });
  assert.deepEqual(after.residueFailures, { 'k:p': { count: 1 } });
  assert.equal(after.lastHealthCheckOkAt, 7);
  assert.equal(after.lastOriginHeadRepairFailedAt, 8);
  assert.ok(after.prStates['b:feat']);
});

test('prefetch resolves concurrently and fills the memo', async () => {
  // Concurrency is proven by the peak number of lookups in flight at once,
  // not by a wall-clock bound (tests/wall-clock-budget-conformance.test.js).
  let inFlight = 0;
  let peak = 0;
  const delayed = (value) => () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    return new Promise((resolve) => setTimeout(() => { inFlight -= 1; resolve(value); }, 20));
  };
  const { deps, calls } = fakeDeps({ byNumberAsync: delayed(OPEN(1)) });
  const r = createPrStateResolver({ root: tmpRoot(), concurrency: 8, deps });
  await r.prefetch({ numbers: [1, 2, 3, 4, 5, 6, 7, 8] });
  assert.equal(peak, 8, `expected all 8 lookups in flight at once, peak was ${peak}`);
  assert.equal(calls.byNumberAsync, 8);
  for (let n = 1; n <= 8; n++) r.byNumber(n);
  assert.equal(calls.byNumber, 0);
});

test('prefetch dedupes keys, skips falsy branches and already-known keys', async () => {
  const { deps, calls } = fakeDeps({ byNumberAsync: OPEN(1), byBranchAsync: null });
  const r = createPrStateResolver({ root: tmpRoot(), deps });
  await r.prefetch({ numbers: [1, 1, 2], branches: ['a', 'a', '', null] });
  assert.equal(calls.byNumberAsync, 2);
  assert.equal(calls.byBranchAsync, 1);
  await r.prefetch({ numbers: [1, 2], branches: ['a'] });
  assert.equal(calls.byNumberAsync, 2);
  assert.equal(calls.byBranchAsync, 1);
});

test('prefetch skips keys served from a persisted entry', async () => {
  const root = tmpRoot();
  writeCache(root, { prStates: { 'n:1': { v: MERGED(1), at: Date.now() } } });
  const { deps, calls } = fakeDeps({ byNumberAsync: OPEN(2) });
  await createPrStateResolver({ root, deps }).prefetch({ numbers: [1, 2] });
  assert.equal(calls.byNumberAsync, 1);
});

test('prefetch honors the concurrency cap', async () => {
  let inFlight = 0; let peak = 0;
  const { deps } = fakeDeps({
    byNumberAsync: () => new Promise((resolve) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      setTimeout(() => { inFlight -= 1; resolve(OPEN(1)); }, 10);
    }),
  });
  await createPrStateResolver({ root: tmpRoot(), concurrency: 2, deps }).prefetch({ numbers: [1, 2, 3, 4, 5, 6] });
  assert.equal(peak, 2);
});

test('a failed prefetch item falls back live', async () => {
  const { deps, calls } = fakeDeps({ byBranchAsync: 'gh-absent', byBranch: OPEN(3) });
  const r = createPrStateResolver({ root: tmpRoot(), deps });
  await r.prefetch({ branches: ['y'] });
  assert.deepEqual(r.byBranch('y'), OPEN(3));
  assert.equal(calls.byBranch, 1);
});

test('a rejecting prefetch item does not abort the batch', async () => {
  const { deps, calls } = fakeDeps({
    byNumberAsync: (n) => { if (n === 1) throw new Error('boom'); return OPEN(n); },
    byNumber: OPEN(1),
  });
  const r = createPrStateResolver({ root: tmpRoot(), deps });
  await r.prefetch({ numbers: [1, 2, 3] });
  r.byNumber(2); r.byNumber(3);
  assert.equal(calls.byNumber, 0);
  r.byNumber(1);
  assert.equal(calls.byNumber, 1);
});

test('async twins share the memo and learn persistable answers', async () => {
  const root = tmpRoot();
  const a = fakeDeps({ byNumberAsync: MERGED(6), byBranchAsync: null });
  const A = createPrStateResolver({ root, deps: a.deps });
  assert.deepEqual(await A.byNumberAsync(6), MERGED(6));
  assert.deepEqual(await A.byNumberAsync(6), MERGED(6));
  assert.equal(await A.byBranchAsync('q'), null);
  assert.equal(a.calls.byNumberAsync, 1);
  assert.deepEqual(A.byNumber(6), MERGED(6));
  assert.equal(a.calls.byNumber, 0);
  A.persist();
  assert.deepEqual(Object.keys(readCache(root).prStates).sort(), ['b:q', 'n:6']);
});

test('default deps: an invalid number reaches pr-state.js and returns its failure string uncached', () => {
  const r = createPrStateResolver({ root: tmpRoot() });
  assert.equal(r.byNumber('not-a-number'), 'invalid-arguments');
  assert.equal(r.byNumber(-1), 'invalid-arguments');
});

// ---- batched prefetch (#4032 Task 4c) ----

test('prefetch: batch answers skip the per-item twins', async () => {
  const root = tmpRoot();
  const { deps, calls } = fakeDeps({ byNumberAsync: OPEN(3), byBranchAsync: null });
  const batchCalls = [];
  deps.fetchBatch = async (r, keys) => {
    batchCalls.push({ r, keys });
    return { byNumber: new Map([[1, MERGED(1)], [2, OPEN(2)]]), byHead: new Map([['b', MERGED(9)]]) };
  };
  const res = createPrStateResolver({ root, deps });
  await res.prefetch({ numbers: [1, 2, 3], branches: ['b', 'c'] });
  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0].r, root);
  assert.deepEqual(batchCalls[0].keys, { numbers: [1, 2, 3], heads: ['b', 'c'] });
  assert.equal(calls.byNumberAsync, 1, 'only the unanswered number 3 goes per item');
  assert.equal(calls.byBranchAsync, 1, 'only the unanswered head c goes per item');
  assert.deepEqual(res.byNumber(1), MERGED(1));
  assert.deepEqual(res.byNumber(2), OPEN(2));
  assert.deepEqual(res.byBranch('b'), MERGED(9));
  assert.deepEqual(res.byNumber(3), OPEN(3));
  assert.equal(calls.byNumber + calls.byBranch, 0, 'every key is now memoized');
});

test('prefetch: batch answers persist exactly like per-item answers', async () => {
  const root = tmpRoot();
  const { deps } = fakeDeps();
  deps.fetchBatch = async () => ({
    byNumber: new Map([[1, MERGED(1)], [2, OPEN(2)]]),
    byHead: new Map([['merged-b', MERGED(9)], ['none', null], ['open-b', OPEN(4)]]),
  });
  const res = createPrStateResolver({ root, deps });
  await res.prefetch({ numbers: [1, 2], branches: ['merged-b', 'none', 'open-b'] });
  res.persist();
  assert.deepEqual(Object.keys(readCache(root).prStates).sort(), ['b:merged-b', 'b:none', 'n:1']);
});

test('prefetch: a throwing fetchBatch degrades to per-item', async () => {
  const { deps, calls } = fakeDeps({ byNumberAsync: OPEN(1), byBranchAsync: null });
  deps.fetchBatch = async () => { throw new Error('batch down'); };
  const res = createPrStateResolver({ root: tmpRoot(), deps });
  await res.prefetch({ numbers: [1, 2], branches: ['a'] });
  assert.equal(calls.byNumberAsync, 2);
  assert.equal(calls.byBranchAsync, 1);
});

test('prefetch: an empty or malformed fetchBatch result degrades to per-item', async () => {
  for (const result of [{ byNumber: new Map(), byHead: new Map() }, undefined, null, {}]) {
    const { deps, calls } = fakeDeps({ byNumberAsync: OPEN(1), byBranchAsync: null });
    deps.fetchBatch = async () => result;
    await createPrStateResolver({ root: tmpRoot(), deps }).prefetch({ numbers: [1], branches: ['a'] });
    assert.equal(calls.byNumberAsync, 1, JSON.stringify(result));
    assert.equal(calls.byBranchAsync, 1, JSON.stringify(result));
  }
});

test('prefetch: a failure string in a batch answer is never memoized', async () => {
  const { deps, calls } = fakeDeps({ byNumberAsync: OPEN(1) });
  deps.fetchBatch = async () => ({ byNumber: new Map([[1, 'network-failure']]), byHead: new Map() });
  const res = createPrStateResolver({ root: tmpRoot(), deps });
  await res.prefetch({ numbers: [1] });
  assert.equal(calls.byNumberAsync, 1, 'the failure string is treated as unanswered');
});

test('prefetch: known keys are not asked of the batch, and an all-known prefetch makes no batch call', async () => {
  const root = tmpRoot();
  writeCache(root, { prStates: { 'n:1': { v: MERGED(1), at: Date.now() } } });
  const { deps } = fakeDeps({ byNumberAsync: OPEN(2) });
  const asked = [];
  deps.fetchBatch = async (r, keys) => { asked.push(keys); return { byNumber: new Map(), byHead: new Map() }; };
  const res = createPrStateResolver({ root, deps });
  await res.prefetch({ numbers: [1, 2] });
  assert.deepEqual(asked, [{ numbers: [2], heads: [] }]);
  await res.prefetch({ numbers: [1, 2] });
  assert.equal(asked.length, 1, 'nothing left to ask');
});

test('prefetch: a non-integer number never reaches the batch and is left to the per-item path', async () => {
  const { deps, calls } = fakeDeps({ byNumberAsync: 'invalid-arguments' });
  const asked = [];
  deps.fetchBatch = async (r, keys) => { asked.push(keys); return { byNumber: new Map(), byHead: new Map() }; };
  await createPrStateResolver({ root: tmpRoot(), deps }).prefetch({ numbers: ['abc', 5] });
  assert.deepEqual(asked, [{ numbers: [5], heads: [] }]);
  assert.equal(calls.byNumberAsync, 2);
});

test('peekNumber never calls live', () => {
  const { deps, calls } = fakeDeps({ byNumber: OPEN(5), byNumberAsync: OPEN(5) });
  const root = tmpRoot();
  writeCache(root, { prStates: { 'n:9': { v: MERGED(9), at: Date.now() }, 'n:8': { v: MERGED(8), at: Date.now() - RET - 1 } } });
  const res = createPrStateResolver({ root, deps });
  assert.equal(res.peekNumber(5), undefined);
  assert.equal(res.peekNumber(0), undefined);
  assert.deepEqual(calls, { byNumber: 0, byBranch: 0, byNumberAsync: 0, byBranchAsync: 0 });
  assert.deepEqual(res.peekNumber(9), MERGED(9), 'a still-valid persisted entry answers');
  assert.equal(res.peekNumber(8), undefined, 'an expired persisted entry does not');
  res.byNumber(5);
  assert.deepEqual(res.peekNumber(5), OPEN(5));
  assert.equal(calls.byNumber, 1);
});

test('peekNumber returns a memoized null (a number that names no governing PR)', async () => {
  const { deps } = fakeDeps({ byNumberAsync: null });
  const res = createPrStateResolver({ root: tmpRoot(), deps });
  await res.prefetch({ numbers: [7] });
  assert.equal(res.peekNumber(7), null);
});
