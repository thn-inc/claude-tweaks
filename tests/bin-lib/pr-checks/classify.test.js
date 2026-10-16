'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FAILING_CONCLUSIONS, normalizeEntry, classifyRollup } = require('../../../plugin/bin/lib/pr-checks/classify');

const HEAD = 'a'.repeat(40);
const run = (name, status, conclusion) => ({ __typename: 'CheckRun', name, status, conclusion, detailsUrl: `https://ci.example/${name}` });

function assertRed(classify) {
  const r = classify({ rollup: [run('test', 'COMPLETED', 'FAILURE'), run('lint', 'COMPLETED', 'SUCCESS')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true });
  assert.equal(r.state, 'red');
  assert.deepEqual(r.failing, [{ name: 'test', url: 'https://ci.example/test' }]);
}

test('FAILING_CONCLUSIONS mirrors pr-first-merge.md Step 2.5', () => {
  assert.deepEqual([...FAILING_CONCLUSIONS], ['FAILURE', 'TIMED_OUT', 'ERROR', 'STARTUP_FAILURE']);
  assert.ok(Object.isFrozen(FAILING_CONCLUSIONS));
});

test('a failing completed check at HEAD is red, naming the check and its URL', () => {
  assertRed(classifyRollup);
});

test('the red assertion discriminates: a stub that always returns green fails it', () => {
  const alwaysGreen = () => ({ state: 'green', failing: [], pending: [], headRefOid: HEAD });
  assert.throws(() => assertRed(alwaysGreen), assert.AssertionError);
});

for (const c of ['TIMED_OUT', 'ERROR', 'STARTUP_FAILURE']) {
  test(`conclusion ${c} is red`, () => {
    const r = classifyRollup({ rollup: [run('x', 'COMPLETED', c)], headRefOid: HEAD, localHead: HEAD, hasPrCi: true });
    assert.equal(r.state, 'red');
  });
}

test('red wins over pending in the same rollup (merge-gate order)', () => {
  const r = classifyRollup({ rollup: [run('a', 'IN_PROGRESS', ''), run('b', 'COMPLETED', 'FAILURE')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true });
  assert.equal(r.state, 'red');
});

test('an in-progress check with conclusion "" (real gh shape) is pending', () => {
  const r = classifyRollup({ rollup: [run('test', 'IN_PROGRESS', ''), run('lint', 'COMPLETED', 'SUCCESS')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true });
  assert.equal(r.state, 'pending');
  assert.deepEqual(r.pending, ['test']);
  assert.deepEqual(r.failing, []);
});

test('headRefOid != local HEAD is stale, even when a check is red', () => {
  const r = classifyRollup({ rollup: [run('test', 'COMPLETED', 'FAILURE')], headRefOid: 'b'.repeat(40), localHead: HEAD, hasPrCi: true });
  assert.equal(r.state, 'stale');
  assert.deepEqual(r.failing, []);
  assert.equal(r.headRefOid, 'b'.repeat(40));
});

test('an empty rollup with a PR workflow is pending (checks not reported yet)', () => {
  const r = classifyRollup({ rollup: [], headRefOid: HEAD, localHead: HEAD, hasPrCi: true });
  assert.equal(r.state, 'pending');
});

test('an empty rollup with no PR workflow is no-ci', () => {
  const r = classifyRollup({ rollup: [], headRefOid: HEAD, localHead: HEAD, hasPrCi: false });
  assert.equal(r.state, 'no-ci');
});

test('all SUCCESS/NEUTRAL/SKIPPED at HEAD is green', () => {
  const r = classifyRollup({ rollup: [run('a', 'COMPLETED', 'SUCCESS'), run('b', 'COMPLETED', 'NEUTRAL'), run('c', 'COMPLETED', 'SKIPPED')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true });
  assert.equal(r.state, 'green');
});

test('a non-array rollup or missing headRefOid is read-failed, never green', () => {
  assert.equal(classifyRollup({ rollup: null, headRefOid: HEAD, localHead: HEAD, hasPrCi: true }).state, 'read-failed');
  assert.equal(classifyRollup({ rollup: [], headRefOid: '', localHead: HEAD, hasPrCi: true }).state, 'read-failed');
});

test('a missing local HEAD is stale (nothing to compare against)', () => {
  assert.equal(classifyRollup({ rollup: [], headRefOid: HEAD, localHead: '', hasPrCi: true }).state, 'stale');
});

test('StatusContext entries are normalized: FAILURE red, PENDING pending, SUCCESS green', () => {
  const ctx = (context, state) => ({ __typename: 'StatusContext', context, state, targetUrl: `https://ci.example/${context}` });
  assert.deepEqual(normalizeEntry(ctx('ci/x', 'FAILURE')), { name: 'ci/x', url: 'https://ci.example/ci/x', status: 'COMPLETED', conclusion: 'FAILURE' });
  assert.equal(classifyRollup({ rollup: [ctx('ci/x', 'ERROR')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true }).state, 'red');
  assert.equal(classifyRollup({ rollup: [ctx('ci/x', 'PENDING')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true }).state, 'pending');
  assert.equal(classifyRollup({ rollup: [ctx('ci/x', 'EXPECTED')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true }).state, 'pending');
  assert.equal(classifyRollup({ rollup: [ctx('ci/x', 'SUCCESS')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true }).state, 'green');
});
