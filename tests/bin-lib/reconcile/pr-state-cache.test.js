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
  const delayed = (value) => () => new Promise((resolve) => setTimeout(() => resolve(value), 20));
  const { deps, calls } = fakeDeps({ byNumberAsync: delayed(OPEN(1)) });
  const r = createPrStateResolver({ root: tmpRoot(), concurrency: 8, deps });
  const t0 = Date.now();
  await r.prefetch({ numbers: [1, 2, 3, 4, 5, 6, 7, 8] });
  assert.ok(Date.now() - t0 < 120, `prefetch took ${Date.now() - t0}ms`);
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
