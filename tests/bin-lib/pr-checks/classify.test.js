'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FAILING_CONCLUSIONS, HELD_CONCLUSIONS, HEAD_RUN_FIELDS, heldChecks, normalizeEntry, normalizeHeadRun, classifyRollup, failingNamesAt, applyBaseComparison } = require('../../../plugin/bin/lib/pr-checks/classify');

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

test('AC1.1: a cancelled completed head run is pending, not green', () => {
  const r = classifyRollup({ rollup: GREEN_ROLLUP, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [hr('test', 'completed', 'cancelled')] });
  assert.equal(r.state, 'pending');
  assert.equal(r.held[0].conclusion, 'CANCELLED');
});

// #3467 — a check whose newest run concluded CANCELLED/ACTION_REQUIRED/STALE is held (pending).
const T1 = '2026-11-26T10:00:00Z';
const T2 = '2026-11-26T10:05:00Z';
const hrAt = (name, conclusion, extra) => ({ ...hr(name, 'completed', conclusion), ...extra });
const gate = (headRuns, rollup = GREEN_ROLLUP) => classifyRollup({ rollup, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns });
const bothOrders = (a, b, rollup) => [gate([a, b], rollup).state, gate([b, a], rollup).state];

for (const c of ['CANCELLED', 'ACTION_REQUIRED', 'STALE']) {
  test(`AC1.1: a ${c} rollup check at HEAD is pending, not green`, () => {
    const r = classifyRollup({ rollup: [run('test', 'COMPLETED', c), run('lint', 'COMPLETED', 'SUCCESS')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true });
    assert.equal(r.state, 'pending');
    assert.deepEqual(r.pending, ['test']);
    assert.deepEqual(r.held, [{ name: 'test', url: 'https://ci.example/test', conclusion: c }]);
  });
}

test('a successful rerun newer than a cancelled run reads green, in either row order', () => {
  const cancelled = hrAt('test', 'cancelled', { startedAt: T1 });
  const success = hrAt('test', 'success', { startedAt: T2 });
  assert.deepEqual(bothOrders(cancelled, success), ['green', 'green']);
});

test('a cancelled run newer than a success is pending', () => {
  const cancelled = hrAt('test', 'cancelled', { startedAt: T2 });
  const success = hrAt('test', 'success', { startedAt: T1 });
  assert.deepEqual(bothOrders(cancelled, success), ['pending', 'pending']);
});

test('equal startedAt: the higher databaseId decides', () => {
  assert.deepEqual(bothOrders(hrAt('test', 'success', { startedAt: T1, databaseId: 2 }), hrAt('test', 'cancelled', { startedAt: T1, databaseId: 1 })), ['green', 'green']);
  assert.deepEqual(bothOrders(hrAt('test', 'success', { startedAt: T1, databaseId: 1 }), hrAt('test', 'cancelled', { startedAt: T1, databaseId: 2 })), ['pending', 'pending']);
});

test('a tie it cannot break, containing a held row, is held (fail closed)', () => {
  assert.deepEqual(bothOrders(hr('test', 'completed', 'success'), hr('test', 'completed', 'cancelled')), ['pending', 'pending']);
});

test('REST rows order by run_started_at, then created_at, ties by id', () => {
  const restRow = (conclusion, extra) => ({ name: 'test', status: 'completed', conclusion, ...extra });
  const cancelled = (startedAt) => hrAt('test', 'cancelled', { startedAt });
  assert.deepEqual(bothOrders(restRow('success', { run_started_at: T2, id: 5 }), cancelled(T1)), ['green', 'green']);
  assert.deepEqual(bothOrders(restRow('success', { run_started_at: T1, id: 5 }), cancelled(T2)), ['pending', 'pending']);
  assert.deepEqual(bothOrders(restRow('success', { created_at: T2, id: 5 }), cancelled(T1)), ['green', 'green']);
  assert.deepEqual(bothOrders(restRow('success', { created_at: T1, id: 5 }), cancelled(T2)), ['pending', 'pending']);
  assert.deepEqual(bothOrders(restRow('success', { created_at: T1, id: 7 }), restRow('cancelled', { created_at: T1, id: 6 })), ['green', 'green']);
});

test('a gh-shaped cancelled run older than a REST-shaped success of the same check reads green: the REST time is parsed', () => {
  const r = gate([
    { ...hr('test', 'completed', 'cancelled'), startedAt: T1, databaseId: 9 },
    { name: 'test', status: 'completed', conclusion: 'success', run_started_at: T2, id: 5 },
  ]);
  assert.equal(r.state, 'green');
});

test('cross-source: a cancelled rollup job and a newer successful head run of the same name read green', () => {
  const rollup = [{ ...run('test', 'COMPLETED', 'CANCELLED'), startedAt: T1 }, ...GREEN_ROLLUP];
  assert.equal(gate([hrAt('test', 'success', { startedAt: T2 })], rollup).state, 'green');
});

test('cross-source: a cancelled rollup job newer than a successful head run of the same name reads pending', () => {
  const rollup = [{ ...run('test', 'COMPLETED', 'CANCELLED'), startedAt: T2 }, ...GREEN_ROLLUP];
  assert.equal(gate([hrAt('test', 'success', { startedAt: T1 })], rollup).state, 'pending');
});

test('a skipped head run stays green', () => {
  assert.equal(gate([hr('test', 'completed', 'skipped')]).state, 'green');
});

test('red wins over a held check and names only the failing check', () => {
  const r = classifyRollup({ rollup: [run('test', 'COMPLETED', 'CANCELLED'), run('lint', 'COMPLETED', 'FAILURE')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true });
  assert.equal(r.state, 'red');
  assert.deepEqual(r.failing.map((f) => f.name), ['lint']);
});

test('a FAILURE row stays red even when a newer success supersedes it', () => {
  const r = gate([hrAt('test', 'failure', { startedAt: T1 }), hrAt('test', 'success', { startedAt: T2 })]);
  assert.equal(r.state, 'red');
});

test('a held check whose newer run is in progress is pending and named once', () => {
  const r = gate([hrAt('test', 'cancelled', { startedAt: T1 }), { ...hr('test', 'in_progress', ''), startedAt: T2 }], []);
  assert.equal(r.state, 'pending');
  assert.deepEqual(r.pending, ['test']);
  assert.equal('held' in r, false);
});

test('a held check and an awaiting ready-run both reach the result alongside pending', () => {
  const r = classifyRollup({ rollup: [run('test', 'COMPLETED', 'CANCELLED')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true, readySince: '2026-11-11T00:45:28Z', readyWorkflows: ['.github/workflows/ci.yml'] });
  assert.equal(r.state, 'pending');
  assert.deepEqual(r.pending, ['test']);
  assert.equal(r.held.length, 1);
  assert.deepEqual(r.awaitingReadyRun, ['.github/workflows/ci.yml']);
});

test('HELD_CONCLUSIONS is the unverified set minus SKIPPED', () => {
  assert.deepEqual([...HELD_CONCLUSIONS], ['CANCELLED', 'ACTION_REQUIRED', 'STALE']);
  assert.equal(Object.isFrozen(HELD_CONCLUSIONS), true);
});

test('a nameless held row is held (fail closed), a nameless non-held row is skipped', () => {
  const rollup = [...GREEN_ROLLUP, { status: 'COMPLETED', conclusion: 'CANCELLED' }];
  const r = classifyRollup({ rollup, headRefOid: HEAD, localHead: HEAD, hasPrCi: true });
  assert.equal(r.state, 'pending');
  assert.equal(r.held[0].name, null);
  assert.equal(r.held[0].conclusion, 'CANCELLED');
  assert.ok(r.pending.includes(null), 'a nameless held row reaches pending as null; pr-checks.js renders it as unnamed');
  const h = classifyRollup({ rollup: GREEN_ROLLUP, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [{ status: 'completed', conclusion: 'cancelled' }] });
  assert.equal(h.state, 'pending');
  assert.equal(h.held[0].name, null);
  const ok = classifyRollup({ rollup: [...GREEN_ROLLUP, { status: 'COMPLETED', conclusion: 'SUCCESS' }], headRefOid: HEAD, localHead: HEAD, hasPrCi: true });
  assert.equal(ok.state, 'green');
});

test('heldChecks is exported and reads head runs alone', () => {
  assert.deepEqual(heldChecks([], [hr('test', 'completed', 'cancelled')]), [{ name: 'test', url: 'https://ci.example/runs/test', conclusion: 'CANCELLED' }]);
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

test('PR_EVENTS is the same set as merge-verification PR_TRIGGERS (the workflow reader and the ready-run rule agree on what a PR event is)', () => {
  const { PR_TRIGGERS } = require('../../../plugin/bin/lib/merge-verification');
  assert.deepEqual([...PR_EVENTS].sort(), [...PR_TRIGGERS].sort());
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

for (const conclusion of ['skipped', 'cancelled', 'action_required', 'stale']) {
  test(`#5153 a lone post-ready run that concluded ${conclusion} verified nothing, so the workflow is still awaiting its ready run`, () => {
    const r = ready([rest(W, 'pull_request', AFTER, 'completed', conclusion, 50)]);
    assert.equal(r.state, 'pending');
    assert.deepEqual(r.awaitingReadyRun, [W]);
    assert.deepEqual(readyRunVerdict({ readySince: READY, readyWorkflows: [W], headRuns: [rest(W, 'pull_request', AFTER, 'completed', conclusion, 50)] }), { awaiting: [W], pending: [], failing: [] });
  });
}

test('#5153 a post-ready skipped run newer than a post-ready success is ignored, so the success decides and the gate is green', () => {
  const r = ready([rest(W, 'pull_request', AFTER, 'completed', 'success', 51), rest(W, 'pull_request', '2026-11-11T00:50:00Z', 'completed', 'skipped', 52)]);
  assert.equal(r.state, 'green');
  assert.equal('awaitingReadyRun' in r, false);
});

test('#5153 a post-ready skipped run beside a post-ready run in progress is pending on that run, not awaiting', () => {
  const r = ready([rest(W, 'pull_request', '2026-11-11T00:50:00Z', 'completed', 'skipped', 53), rest(W, 'pull_request', AFTER, 'in_progress', null, 54)]);
  assert.equal(r.state, 'pending');
  assert.equal('awaitingReadyRun' in r, false);
  assert.deepEqual(readyRunVerdict({ readySince: READY, readyWorkflows: [W], headRuns: [rest(W, 'pull_request', '2026-11-11T00:50:00Z', 'completed', 'skipped', 53), rest(W, 'pull_request', AFTER, 'in_progress', null, 54)] }).pending, [W]);
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

test('guard (b1): a workflow file with `@` in its name matches its own run path, with or without an @ref suffix', () => {
  const AT = '.github/workflows/ci@v2.yml';
  const at = (headRuns) => readyRunVerdict({ readySince: READY, readyWorkflows: [AT], headRuns });
  assert.deepEqual(at([rest(AT, 'pull_request', AFTER, 'completed', 'success', 30)]), { awaiting: [], pending: [], failing: [] });
  assert.deepEqual(at([rest(`${AT}@refs/pull/7/merge`, 'pull_request', AFTER, 'completed', 'failure', 31)]).failing, [{ name: 'ci', url: 'https://github.example/runs/31' }]);
  // A different file sharing the `@`-prefix never matches, nor does the bare name before the `@`.
  assert.deepEqual(at([rest('.github/workflows/ci@v2.yml2', 'pull_request', AFTER, 'completed', 'success', 32)]).awaiting, [AT]);
  assert.deepEqual(at([rest('.github/workflows/ci', 'pull_request', AFTER, 'completed', 'success', 33)]).awaiting, [AT]);
  assert.equal(classifyRollup({ rollup: GREEN_ROLLUP, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [rest(AT, 'pull_request', AFTER, 'completed', 'success', 34)], readySince: READY, readyWorkflows: [AT] }).state, 'green');
});

test('guard (b1s): a sibling workflow file named `W@….yml` never satisfies W, with or without its own @ref (fail closed)', () => {
  const v = (p) => readyRunVerdict({ readySince: READY, readyWorkflows: [W], headRuns: [rest(p, 'pull_request', AFTER, 'completed', 'success', 40)] });
  for (const sibling of [`${W}@v2.yml`, `${W}@v2.yml@refs/pull/7/merge`, `${W}@v2.yml@main`]) {
    assert.deepEqual(v(sibling), { awaiting: [W], pending: [], failing: [] }, sibling);
    const r = ready([rest(sibling, 'pull_request', AFTER, 'completed', 'success', 41)]);
    assert.equal(r.state, 'pending', sibling);
    assert.deepEqual(r.awaitingReadyRun, [W], sibling);
  }
  // W's own run with a ref suffix still matches.
  for (const own of [`${W}@refs/pull/7/merge`, `${W}@refs/heads/feat@x`]) {
    assert.deepEqual(v(own), { awaiting: [], pending: [], failing: [] }, own);
  }
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

test('#5153 readyRunVerdict called directly: a pathless row never counts, even for an empty-string workflow', () => {
  const pathless = { name: 'ci', workflowName: 'ci', status: 'completed', conclusion: 'success', event: 'pull_request', createdAt: AFTER, databaseId: 25 };
  assert.deepEqual(readyRunVerdict({ readySince: READY, readyWorkflows: [''], headRuns: [pathless] }), { awaiting: [''], pending: [], failing: [] });
  assert.deepEqual(readyRunVerdict({ readySince: READY, readyWorkflows: [W], headRuns: [pathless] }).awaiting, [W]);
});

test('#5153 readyRunVerdict called directly: a row whose path is empty or strips to empty never counts for an empty-string workflow', () => {
  for (const path of ['', '@x', '@refs/heads/x']) {
    const row = rest(path, 'pull_request', AFTER, 'completed', 'success', 26);
    assert.deepEqual(readyRunVerdict({ readySince: READY, readyWorkflows: [''], headRuns: [row] }), { awaiting: [''], pending: [], failing: [] });
  }
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

test('HEAD_RUN_FIELDS carries start time and id for newest-per-check ordering', () => {
  assert.equal(HEAD_RUN_FIELDS, 'databaseId,name,workflowName,status,conclusion,url,startedAt,event,createdAt');
  assert.equal(PR_EVENT_SETTLE_MS, 60000);
});

// #3468 — the PR-event settle window.
const { PR_EVENT_SETTLE_MS, prEventSettle } = require('../../../plugin/bin/lib/pr-checks/classify');
const T0 = Date.parse('2026-11-26T10:00:00Z');
const SETTLE_ROLLUP = [run('track', 'COMPLETED', 'SUCCESS')];
const prRun = (createdAt) => ({ name: 'test', workflowName: 'test', status: 'completed', conclusion: 'success', event: 'pull_request', createdAt });
const pushRun = (createdAt) => ({ ...prRun(createdAt), name: 'track', workflowName: 'track', event: 'push' });
const PR_OPENED = '2026-11-26T09:59:00Z';
const settle = (over) => classifyRollup({ rollup: SETTLE_ROLLUP, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [pushRun('2026-11-26T10:00:00Z')], prCreatedAt: PR_OPENED, now: T0 + 30000, ...over });
const at = (hms) => Date.parse(`2026-11-26T${hms}Z`);

test('AC1.1: a completed push run with no pull_request run yet reads pending inside the 60 s window', () => {
  const v = settle();
  assert.equal(v.state, 'pending');
  assert.equal(v.prEventSettle.until, '2026-11-26T10:01:00.000Z');
});

test('AC2.1: a path-filtered PR (push runs only) reads green once the window has passed', () => {
  const v = settle({ now: T0 + 60001 });
  assert.equal(v.state, 'green');
  assert.equal('prEventSettle' in v, false);
});

test('the window closes at exactly 60 s', () => {
  assert.equal(settle({ now: T0 + 60000 }).state, 'green');
});

test('a pull_request head run ends the settle rule', () => {
  assert.equal(settle({ headRuns: [pushRun('2026-11-26T10:00:00Z'), prRun('2026-11-26T10:00:01Z')], now: T0 + 1000 }).state, 'green');
});

test('a pull_request_target head run ends the settle rule', () => {
  assert.equal(settle({ headRuns: [pushRun('2026-11-26T10:00:00Z'), { ...prRun('2026-11-26T10:00:01Z'), event: 'pull_request_target' }], now: T0 + 1000 }).state, 'green');
});

test('the window anchors on the earliest run under any event', () => {
  const both = [pushRun('2026-11-26T10:00:20Z'), pushRun('2026-11-26T10:00:05Z')];
  assert.equal(settle({ headRuns: both, now: at('10:01:06') }).state, 'green');
  assert.equal(settle({ headRuns: both, now: at('10:01:04') }).state, 'pending');
  assert.equal(settle({ headRuns: [pushRun('2026-11-26T10:00:20Z')], now: at('10:01:06') }).state, 'pending');
});

test('AC1.1: a PR opened after its head was pushed: the window starts at the PR\'s createdAt', () => {
  const o = { headRuns: [pushRun('2026-11-26T10:00:00Z')], prCreatedAt: '2026-11-26T10:05:00Z' };
  const v = settle({ ...o, now: at('10:05:30') });
  assert.equal(v.state, 'pending');
  assert.equal(v.prEventSettle.until, '2026-11-26T10:06:00.000Z');
  assert.equal(settle({ ...o, now: at('10:06:01') }).state, 'green');
});

test('with no head run, the PR\'s createdAt still caps the committer date from below', () => {
  const v = settle({ rollup: [{ context: 'ext', state: 'SUCCESS' }], headRuns: [], headCommittedAt: '2026-11-26T10:00:00Z', prCreatedAt: '2026-11-26T10:05:00Z', now: at('10:05:30') });
  assert.equal(v.state, 'pending');
});

test('a missing or unparseable prCreatedAt fails closed', () => {
  const far = at('12:00:00');
  for (const prCreatedAt of [undefined, null, 'not-a-date']) {
    const v = settle({ prCreatedAt, now: far });
    assert.equal(v.state, 'pending');
    assert.equal(v.prEventSettle.until, null);
    assert.equal(settle({ prCreatedAt, now: far, headRuns: [pushRun('2026-11-26T10:00:00Z'), prRun('2026-11-26T10:00:01Z')] }).state, 'green');
  }
});

test('snake_case created_at rows anchor the window', () => {
  const row = { name: 'x', event: 'push', status: 'completed', conclusion: 'success', created_at: '2026-11-26T10:00:00Z' };
  assert.equal(settle({ headRuns: [row], now: T0 + 30000 }).state, 'pending');
  assert.equal(settle({ headRuns: [row], now: T0 + 61000 }).state, 'green');
});

test('no head run at all: the committer date stands in', () => {
  const o = { rollup: [{ context: 'ext', state: 'SUCCESS' }], headRuns: [], headCommittedAt: '2026-11-26T10:00:00Z' };
  assert.equal(settle({ ...o, now: T0 + 59000 }).state, 'pending');
  assert.equal(settle({ ...o, now: T0 + 61000 }).state, 'green');
});

test('prEventSettle: rows with no parseable createdAt fall back to the committer date, else fail closed', () => {
  const headRuns = [{ name: 'track', event: 'push', status: 'completed', conclusion: 'success' }];
  assert.deepEqual(prEventSettle({ hasPrCi: true, headRuns, headCommittedAt: null, prCreatedAt: PR_OPENED, now: T0 }), { settling: true, until: null });
  const v = settle({ headRuns, headCommittedAt: null });
  assert.equal(v.state, 'pending');
  assert.equal(v.prEventSettle.until, null);
  assert.equal(settle({ headRuns, headCommittedAt: '2026-11-26T10:00:00Z', now: T0 + 61000 }).state, 'green');
});

test('red wins inside the settle window', () => {
  const bad = { ...pushRun('2026-11-26T10:00:00Z'), conclusion: 'failure' };
  assert.equal(settle({ headRuns: [bad], now: T0 + 1000 }).state, 'red');
});

test('without PR CI the settle rule never applies', () => {
  assert.equal(settle({ hasPrCi: false, now: T0 }).state, 'green');
});

test('the rule is inactive without a clock', () => {
  assert.equal(settle({ now: undefined }).state, 'green');
});
