'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FAILING_CONCLUSIONS, normalizeEntry, normalizeHeadRun, classifyRollup } = require('../../../plugin/bin/lib/pr-checks/classify');

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

const hr = (workflowName, status, conclusion) => ({ name: workflowName, workflowName, status, conclusion, url: `https://ci.example/runs/${workflowName}`, event: 'pull_request' });
const GREEN_ROLLUP = [run('label-fix-branch', 'COMPLETED', 'SUCCESS'), run('cleanup-fix-labels', 'COMPLETED', 'SKIPPED')];

test('a green rollup with a head run still in_progress is pending (PR #3390 shape)', () => {
  const r = classifyRollup({ rollup: GREEN_ROLLUP, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [hr('test', 'in_progress', ''), hr('Track issue fixes across branches', 'completed', 'success')] });
  assert.equal(r.state, 'pending');
  assert.deepEqual(r.pending, ['test']);
});

test('every head run completed and successful is green', () => {
  const r = classifyRollup({ rollup: GREEN_ROLLUP, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [hr('test', 'completed', 'success'), hr('Track issue fixes across branches', 'completed', 'success')] });
  assert.equal(r.state, 'green');
});

test('without headRuns the same partial rollup reads green (rollup-only callers keep their behavior)', () => {
  const r = classifyRollup({ rollup: GREEN_ROLLUP, headRefOid: HEAD, localHead: HEAD, hasPrCi: true });
  assert.equal(r.state, 'green');
});

test('a completed head run with a failing conclusion is red', () => {
  const r = classifyRollup({ rollup: GREEN_ROLLUP, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [hr('test', 'completed', 'failure')] });
  assert.equal(r.state, 'red');
  assert.deepEqual(r.failing, [{ name: 'test', url: 'https://ci.example/runs/test' }]);
});

test('rollup red wins over a pending head run', () => {
  const r = classifyRollup({ rollup: [run('test', 'COMPLETED', 'FAILURE')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [hr('lint', 'queued', '')] });
  assert.equal(r.state, 'red');
});

test('a cancelled completed head run is neither red nor pending', () => {
  const r = classifyRollup({ rollup: GREEN_ROLLUP, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [hr('test', 'completed', 'cancelled')] });
  assert.equal(r.state, 'green');
});

test('a workflow in both the rollup and the head runs is named once, and the state is unchanged', () => {
  const pending = classifyRollup({ rollup: [run('test', 'IN_PROGRESS', '')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [hr('test', 'in_progress', '')] });
  assert.equal(pending.state, 'pending');
  assert.deepEqual(pending.pending, ['test']);
  const red = classifyRollup({ rollup: [run('test', 'COMPLETED', 'FAILURE')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [hr('test', 'completed', 'failure')] });
  assert.equal(red.state, 'red');
  assert.deepEqual(red.failing.map((f) => f.name), ['test']);
});

test('a head run row with no status, or a non-object row, is pending (fail safe), never green', () => {
  for (const row of [{ workflowName: 'test', conclusion: 'success' }, 'oops', null]) {
    const r = classifyRollup({ rollup: GREEN_ROLLUP, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [row] });
    assert.equal(r.state, 'pending');
  }
});

test('an empty rollup with only completed head runs follows the empty-rollup lever, not green', () => {
  const headRuns = [hr('test', 'completed', 'success')];
  assert.equal(classifyRollup({ rollup: [], headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns }).state, 'pending');
  assert.equal(classifyRollup({ rollup: [], headRefOid: HEAD, localHead: HEAD, hasPrCi: false, headRuns }).state, 'no-ci');
});

test('pending entries are named by workflowName, falling back to name', () => {
  assert.deepEqual(normalizeHeadRun({ name: 'job', status: 'queued', conclusion: '' }), { name: 'job', url: null, status: 'QUEUED', conclusion: null });
  assert.equal(normalizeHeadRun({ workflowName: 'test', name: 'job', status: 'queued', conclusion: '' }).name, 'test');
});

test('an empty headRuns array leaves the rollup rules in charge', () => {
  assert.equal(classifyRollup({ rollup: [], headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [] }).state, 'pending');
  assert.equal(classifyRollup({ rollup: GREEN_ROLLUP, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [] }).state, 'green');
});

test('a non-array headRuns is read-failed, never green', () => {
  const r = classifyRollup({ rollup: GREEN_ROLLUP, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: null });
  assert.equal(r.state, 'read-failed');
  assert.equal(r.reason, 'malformed-head-runs');
});

test('stale still wins over head runs', () => {
  const r = classifyRollup({ rollup: GREEN_ROLLUP, headRefOid: 'b'.repeat(40), localHead: HEAD, hasPrCi: true, headRuns: [hr('test', 'in_progress', '')] });
  assert.equal(r.state, 'stale');
});
