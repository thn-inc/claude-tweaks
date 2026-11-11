'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FAILING_CONCLUSIONS, normalizeEntry, normalizeHeadRun, classifyRollup, failingNamesAt, applyBaseComparison } = require('../../../plugin/bin/lib/pr-checks/classify');

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

const BASE = 'b'.repeat(40);
const redVerdict = (names) => ({ state: 'red', failing: names.map((n) => ({ name: n, url: `https://ci.example/${n}` })), pending: [], headRefOid: HEAD });

test('failingNamesAt: real e91df452c shape — job name and workflow name both count', () => {
  const checkRuns = [
    { name: 'file', status: 'completed', conclusion: 'failure' },
    { name: 'test', status: 'completed', conclusion: 'cancelled' },
    { name: 'windows', status: 'completed', conclusion: 'success' },
  ];
  const runs = [
    { databaseId: 11, name: 'windows-regression', workflowName: 'windows-regression', status: 'completed', conclusion: 'failure' },
    { databaseId: 12, name: 'test', workflowName: 'test', status: 'completed', conclusion: 'cancelled' },
  ];
  assert.deepEqual(failingNamesAt({ checkRuns, statuses: [], runs }), ['file', 'windows-regression']);
});

test('failingNamesAt: a failed commit status counts; in-progress and null-named rows do not', () => {
  const names = failingNamesAt({
    checkRuns: [{ name: 'lint', status: 'in_progress', conclusion: null }, { name: null, status: 'completed', conclusion: 'failure' }],
    statuses: [{ context: 'ci/legacy', state: 'failure', target_url: 'u' }, { context: 'ci/ok', state: 'success' }],
    runs: [],
  });
  assert.deepEqual(names, ['ci/legacy']);
});

test('failingNamesAt: a non-array field throws (the CLI turns the throw into plain red — cli.test.js "a malformed base listing")', () => {
  assert.throws(() => failingNamesAt({ checkRuns: {}, statuses: [], runs: [] }), /malformed base read/);
});

test('AC1.1: every failing check also failing at base -> inherited-red with baseSha', () => {
  const r = applyBaseComparison(redVerdict(['test']), { sha: BASE, failing: ['test', 'other'] });
  assert.equal(r.state, 'inherited-red');
  assert.equal(r.baseSha, BASE);
  assert.deepEqual(r.failing, [{ name: 'test', url: 'https://ci.example/test', inherited: true }]);
});

test('AC2.1: one inherited + one new failing check stays red, flagging only the new one attributable', () => {
  const r = applyBaseComparison(redVerdict(['test', 'lint']), { sha: BASE, failing: ['test'] });
  assert.equal(r.state, 'red');
  assert.deepEqual(r.failing.filter((f) => !f.inherited).map((f) => f.name), ['lint']);
  assert.deepEqual(r.failing.filter((f) => f.inherited).map((f) => f.name), ['test']);
});

test('AC3.1: an unreadable base leaves plain red, never green, with baseReason and no inherited flags', () => {
  const v = redVerdict(['test']);
  const r = applyBaseComparison(v, { sha: null, reason: 'gh api failed: HTTP 502' });
  assert.equal(r.state, 'red');
  assert.equal(r.baseReason, 'gh api failed: HTTP 502');
  assert.equal(r.baseSha, null);
  assert.deepEqual(r.failing, v.failing);
  assert.equal(applyBaseComparison(v, undefined).state, 'red');
  assert.equal(applyBaseComparison(v, undefined).baseReason, 'base not read');
});

test('a base check still in progress is not failing there, so the PR failure is attributable', () => {
  const failing = failingNamesAt({ checkRuns: [{ name: 'test', status: 'in_progress', conclusion: null }], statuses: [], runs: [] });
  const r = applyBaseComparison(redVerdict(['test']), { sha: BASE, failing });
  assert.equal(r.state, 'red');
  assert.equal(r.failing[0].inherited, false);
});

test('a null-named failing entry is never inherited', () => {
  const r = applyBaseComparison({ state: 'red', failing: [{ name: null, url: null }], pending: [], headRefOid: HEAD }, { sha: BASE, failing: [null] });
  assert.equal(r.state, 'red');
  assert.equal(r.failing[0].inherited, false);
});

test('failingNamesAt: only the newest run of a workflow counts; a run row without a databaseId is ignored (fails closed)', () => {
  const failed = (databaseId, workflowName) => ({ databaseId, name: workflowName, workflowName, status: 'completed', conclusion: 'failure' });
  const passed = (databaseId, workflowName) => ({ ...failed(databaseId, workflowName), conclusion: 'success' });
  const names = (runs) => failingNamesAt({ checkRuns: [], statuses: [], runs });
  assert.deepEqual(names([failed(5, 'ci'), passed(9, 'ci')]), []);
  assert.deepEqual(names([passed(5, 'ci'), failed(9, 'ci')]), ['ci']);
  assert.deepEqual(names([failed(5, 'ci'), passed(9, 'other')]), ['ci']);
  assert.deepEqual(names([{ name: 'ci', workflowName: 'ci', status: 'completed', conclusion: 'failure' }, passed(9, 'ci')]), []);
  assert.deepEqual(names([{ name: 'ci', workflowName: 'ci', status: 'completed', conclusion: 'failure' }]), []);
});

test('non-red verdicts pass through unchanged (same object)', () => {
  for (const state of ['green', 'pending', 'stale', 'no-ci', 'read-failed']) {
    const v = { state, failing: [], pending: [], headRefOid: HEAD };
    assert.equal(applyBaseComparison(v, { sha: BASE, failing: ['x'] }), v);
  }
});

// --- #5153: ready-run rule (readySince / readyWorkflows) ---
const { readyRunVerdict, PR_EVENTS } = require('../../../plugin/bin/lib/pr-checks/classify');

const READY = '2026-11-11T00:45:28Z';
const BEFORE = '2026-11-11T00:29:06Z';
const AFTER = '2026-11-11T00:46:00Z';
const W = '.github/workflows/ci.yml';
const rest = (path, event, created_at, status, conclusion, id) => ({
  id, name: 'ci', path, event, created_at, status, conclusion, html_url: `https://github.example/runs/${id}`,
});
const ready = (headRuns, rollup = GREEN_ROLLUP, extra = {}) =>
  classifyRollup({ rollup, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns, readySince: READY, readyWorkflows: [W], ...extra });

test('PR_EVENTS is the frozen pull_request pair', () => {
  assert.deepEqual([...PR_EVENTS], ['pull_request', 'pull_request_target']);
  assert.ok(Object.isFrozen(PR_EVENTS));
});

test('#5153 AC1.1: draft-time head runs and rollup entries all completed SKIPPED/SUCCESS are pending with awaitingReadyRun', () => {
  const rollup = [run('ci', 'COMPLETED', 'SKIPPED'), run('label-fix-branch', 'COMPLETED', 'SUCCESS')];
  const r = ready([rest(W, 'pull_request', BEFORE, 'completed', 'skipped', 1)], rollup);
  assert.equal(r.state, 'pending');
  assert.deepEqual(r.awaitingReadyRun, [W]);
  assert.deepEqual(r.pending, []);
});

test('#5153 AC1.2: readySince set and a ready workflow with no head run at or after it is pending with awaitingReadyRun', () => {
  const r = ready([]);
  assert.equal(r.state, 'pending');
  assert.deepEqual(r.awaitingReadyRun, [W]);
});

test('#5153 AC1.3: a pre-ready run, including a re-run that keeps its original createdAt, does not satisfy the requirement', () => {
  const row = { ...rest(W, 'pull_request', '2026-11-11T00:45:27Z', 'completed', 'success', 2), run_attempt: 2 };
  const r = ready([row]);
  assert.equal(r.state, 'pending');
  assert.deepEqual(r.awaitingReadyRun, [W]);
});

test('#5153 AC2.1: a matching post-ready run in progress is pending', () => {
  const r = ready([rest(W, 'pull_request', AFTER, 'in_progress', null, 5)]);
  assert.equal(r.state, 'pending');
  assert.equal('awaitingReadyRun' in r, false);
});

test('#5153 AC2.2: a matching post-ready run that fails is red', () => {
  const r = ready([rest(W, 'pull_request', AFTER, 'completed', 'failure', 6)]);
  assert.equal(r.state, 'red');
  assert.deepEqual(r.failing.map((f) => f.name), ['ci']);
});

test('#5153 AC2.3: a matching post-ready run that succeeds is green', () => {
  const r = ready([rest(W, 'pull_request', AFTER, 'completed', 'success', 7)]);
  assert.equal(r.state, 'green');
  assert.equal('awaitingReadyRun' in r, false);
});

test('#5153 AC3.1: a red head run still returns red while a ready run is awaited', () => {
  const r = ready([hr('lint', 'completed', 'failure')]);
  assert.equal(r.state, 'red');
  assert.equal('awaitingReadyRun' in r, false);
});

test('#5153 AC4.1: with readySince/readyWorkflows absent or empty every existing classify case returns its current verdict, unchanged', () => {
  const ctx = (context, state) => ({ __typename: 'StatusContext', context, state, targetUrl: `https://ci.example/${context}` });
  const base = { headRefOid: HEAD, localHead: HEAD, hasPrCi: true };
  const inputs = [
    { ...base, rollup: [run('test', 'COMPLETED', 'FAILURE'), run('lint', 'COMPLETED', 'SUCCESS')] },
    { ...base, rollup: [run('a', 'IN_PROGRESS', ''), run('b', 'COMPLETED', 'FAILURE')] },
    { ...base, rollup: [run('test', 'IN_PROGRESS', ''), run('lint', 'COMPLETED', 'SUCCESS')] },
    { ...base, rollup: [run('test', 'COMPLETED', 'FAILURE')], headRefOid: 'b'.repeat(40) },
    { ...base, rollup: [] },
    { ...base, rollup: [], hasPrCi: false },
    { ...base, rollup: [run('a', 'COMPLETED', 'SUCCESS'), run('b', 'COMPLETED', 'NEUTRAL'), run('c', 'COMPLETED', 'SKIPPED')] },
    { ...base, rollup: null },
    { ...base, rollup: [], localHead: '' },
    { ...base, rollup: [ctx('ci/x', 'FAILURE')] },
    { ...base, rollup: [ctx('ci/x', 'PENDING')] },
    { ...base, rollup: [ctx('ci/x', 'SUCCESS')] },
    { ...base, rollup: GREEN_ROLLUP, headRuns: [hr('test', 'in_progress', '')] },
    { ...base, rollup: GREEN_ROLLUP, headRuns: [hr('test', 'completed', 'success')] },
    { ...base, rollup: GREEN_ROLLUP, headRuns: [hr('test', 'completed', 'failure')] },
    { ...base, rollup: GREEN_ROLLUP, headRuns: [hr('test', 'completed', 'cancelled')] },
    { ...base, rollup: GREEN_ROLLUP, headRuns: [{ workflowName: 'test', conclusion: 'success' }, 'oops', null] },
    { ...base, rollup: [], headRuns: [hr('test', 'completed', 'success')] },
    { ...base, rollup: [], hasPrCi: false, headRuns: [hr('test', 'completed', 'success')] },
    { ...base, rollup: GREEN_ROLLUP, headRuns: [] },
    { ...base, rollup: GREEN_ROLLUP, headRuns: null },
  ];
  const extras = [
    {},
    { readySince: null, readyWorkflows: [] },
    { readySince: READY, readyWorkflows: [] },
    { readySince: undefined, readyWorkflows: [W] },
    { readySince: null, readyWorkflows: [W] },
    { readySince: '', readyWorkflows: [W] },
    { readySince: READY, readyWorkflows: undefined },
    { readySince: READY, readyWorkflows: null },
  ];
  for (const input of inputs) {
    const expected = classifyRollup(input);
    for (const extra of extras) assert.deepStrictEqual(classifyRollup({ ...input, ...extra }), expected);
    assert.equal('awaitingReadyRun' in expected, false);
  }
});

test('guard (a): a push-event post-ready row does not count', () => {
  const r = ready([rest(W, 'push', AFTER, 'completed', 'success', 8)]);
  assert.equal(r.state, 'pending');
  assert.deepEqual(r.awaitingReadyRun, [W]);
});

test('guard (a2): a pull_request_target post-ready row counts', () => {
  assert.equal(ready([rest(W, 'pull_request_target', AFTER, 'completed', 'success', 8)]).state, 'green');
});

test('guard (b): a path @ref suffix is dropped, a different path never matches', () => {
  assert.equal(ready([rest(W + '@refs/heads/x', 'pull_request', AFTER, 'completed', 'success', 9)]).state, 'green');
  const r = ready([rest(W + '2', 'pull_request', AFTER, 'completed', 'success', 9)]);
  assert.equal(r.state, 'pending');
  assert.deepEqual(r.awaitingReadyRun, [W]);
});

test('guard (b2): a gh run list row (no path) never counts, even with a matching name and post-ready createdAt', () => {
  const row = { name: 'ci', workflowName: 'ci', status: 'completed', conclusion: 'success', event: 'pull_request', createdAt: AFTER, databaseId: 4, url: 'u' };
  const r = ready([row]);
  assert.equal(r.state, 'pending');
  assert.deepEqual(r.awaitingReadyRun, [W]);
});

test('guard (c): a row with an unparseable created_at does not count', () => {
  const r = ready([rest(W, 'pull_request', 'garbage', 'completed', 'success', 10)]);
  assert.equal(r.state, 'pending');
  assert.deepEqual(r.awaitingReadyRun, [W]);
});

test('guard (d): an unparseable readySince with active workflows is read-failed malformed-ready-since', () => {
  const r = ready([], GREEN_ROLLUP, { readySince: 'garbage' });
  assert.equal(r.state, 'read-failed');
  assert.equal(r.reason, 'malformed-ready-since');
});

test('guard (e): a non-array readyWorkflows is read-failed malformed-ready-workflows', () => {
  const r = ready([], GREEN_ROLLUP, { readyWorkflows: 'ci.yml' });
  assert.equal(r.state, 'read-failed');
  assert.equal(r.reason, 'malformed-ready-workflows');
});

test('guard (f): of two post-ready rows the older failure and newer success report no failing', () => {
  const v = readyRunVerdict({
    readySince: READY, readyWorkflows: [W],
    headRuns: [rest(W, 'pull_request', AFTER, 'completed', 'failure', 11), rest(W, 'pull_request', '2026-11-11T00:50:00Z', 'completed', 'success', 12)],
  });
  assert.deepEqual(v, { awaiting: [], pending: [], failing: [] });
});

test('guard (f2): equal timestamps are ordered by numeric id, not by array order or string order', () => {
  const rows = [rest(W, 'pull_request', AFTER, 'completed', 'success', 100), rest(W, 'pull_request', AFTER, 'completed', 'failure', 9)];
  assert.equal(readyRunVerdict({ readySince: READY, readyWorkflows: [W], headRuns: rows }).failing.length, 0);
  assert.equal(readyRunVerdict({ readySince: READY, readyWorkflows: [W], headRuns: [...rows].reverse() }).failing.length, 0);
});

test('guard (g): a row created after the first ready event but before the last (READY) does not count', () => {
  const r = ready([rest(W, 'pull_request', '2026-11-11T00:40:00Z', 'completed', 'success', 13)]);
  assert.equal(r.state, 'pending');
  assert.deepEqual(r.awaitingReadyRun, [W]);
});

test('guard (h): a lowercase failure post-ready REST row lands in failing as { name, url }', () => {
  const v = readyRunVerdict({ readySince: READY, readyWorkflows: [W], headRuns: [rest(W, 'pull_request', AFTER, 'completed', 'failure', 3)] });
  assert.deepEqual(v.failing, [{ name: 'ci', url: 'https://github.example/runs/3' }]);
  assert.deepEqual(v.pending, []);
});

test('readyRunVerdict: a post-ready non-completed newest row is pending; a missing status is pending', () => {
  const v = readyRunVerdict({ readySince: READY, readyWorkflows: [W], headRuns: [rest(W, 'pull_request', AFTER, 'queued', null, 14)] });
  assert.deepEqual(v.pending, [W]);
  const v2 = readyRunVerdict({ readySince: READY, readyWorkflows: [W], headRuns: [{ path: W, event: 'pull_request', created_at: AFTER, id: 1 }] });
  assert.deepEqual(v2.pending, [W]);
});

test('readyRunVerdict with a run present in both shapes: the gh copy is ignored, the REST copy counts once', () => {
  const ghCopy = { name: 'ci', workflowName: 'ci', status: 'completed', conclusion: 'failure', event: 'pull_request', createdAt: AFTER, databaseId: 15, url: 'u' };
  const restCopy = rest(W, 'pull_request', AFTER, 'completed', 'failure', 15);
  const v = readyRunVerdict({ readySince: READY, readyWorkflows: [W], headRuns: [ghCopy, restCopy] });
  assert.equal(v.failing.length, 1);
  const r = ready([ghCopy, restCopy]);
  assert.equal(r.state, 'red');
  assert.deepEqual(r.failing.map((f) => f.name), ['ci']);
});

test('readyRunVerdict never throws on junk input and reports every workflow awaiting', () => {
  for (const headRuns of [null, undefined, 'x', [null, 'x', 3, {}]]) {
    assert.deepEqual(readyRunVerdict({ readySince: READY, readyWorkflows: [W], headRuns }), { awaiting: [W], pending: [], failing: [] });
  }
  assert.deepEqual(readyRunVerdict(), { awaiting: [], pending: [], failing: [] });
});

test('readyRunVerdict is exported and pure: no input mutation', () => {
  const input = { readySince: READY, readyWorkflows: [W], headRuns: [rest(W, 'pull_request', AFTER, 'completed', 'failure', 16), rest(W, 'push', BEFORE, 'queued', null, 17)] };
  const snapshot = JSON.parse(JSON.stringify(input));
  assert.equal(typeof readyRunVerdict, 'function');
  readyRunVerdict(input);
  ready(input.headRuns);
  assert.deepEqual(input, snapshot);
});

test('#5153 readyRunVerdict called directly: an unparseable, undefined or null readySince fails closed to awaiting', () => {
  const headRuns = [rest(W, 'pull_request', AFTER, 'completed', 'success', 20)];
  assert.deepEqual(readyRunVerdict({ readySince: 'garbage', readyWorkflows: [W], headRuns }).awaiting, [W]);
  assert.deepEqual(readyRunVerdict({ readySince: undefined, readyWorkflows: [W], headRuns }).awaiting, [W]);
  assert.deepEqual(readyRunVerdict({ readySince: null, readyWorkflows: [W], headRuns }).awaiting, [W]);
});

test('#5153 a run created in the same second as readySince counts (at-or-after boundary)', () => {
  const r = ready([rest(W, 'pull_request', READY, 'completed', 'success', 21)]);
  assert.equal(r.state, 'green');
  assert.equal('awaitingReadyRun' in r, false);
});

test('#5153 a non-string readySince is read-failed malformed-ready-since, never green', () => {
  for (const readySince of [1762821928000, {}, true]) {
    const r = ready([rest(W, 'pull_request', AFTER, 'completed', 'success', 22)], GREEN_ROLLUP, { readySince });
    assert.equal(r.state, 'read-failed');
    assert.equal(r.reason, 'malformed-ready-since');
  }
});

test('#5153 a readyWorkflows element that is not a non-empty string is read-failed malformed-ready-workflows', () => {
  const pathless = { name: 'ci', workflowName: 'ci', status: 'completed', conclusion: 'success', event: 'pull_request', createdAt: AFTER, databaseId: 23 };
  for (const readyWorkflows of [[''], [null], [W, 3], [undefined]]) {
    const r = ready([pathless], GREEN_ROLLUP, { readyWorkflows });
    assert.equal(r.state, 'read-failed');
    assert.equal(r.reason, 'malformed-ready-workflows');
  }
});

test('#5153 normalizeHeadRun reads a REST html_url when there is no url, so a REST-only failing run names its link', () => {
  assert.equal(normalizeHeadRun({ name: 'ci', status: 'completed', conclusion: 'failure', html_url: 'https://github.example/runs/9' }).url, 'https://github.example/runs/9');
  assert.equal(normalizeHeadRun({ name: 'ci', url: 'u1', html_url: 'u2' }).url, 'u1');
  const r = ready([rest(W, 'pull_request', AFTER, 'completed', 'failure', 24)]);
  assert.deepEqual(r.failing, [{ name: 'ci', url: 'https://github.example/runs/24' }]);
});
