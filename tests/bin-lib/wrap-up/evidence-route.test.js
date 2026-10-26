// tests/bin-lib/wrap-up/evidence-route.test.js
// Pure decision module for verification-brief Step 4's screenshot route (#4125).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SAFE_BRANCH_RE,
  STATES,
  ROUTES,
  REASONS,
  decideEvidenceRoute,
  branchReadState,
  stripTrailingSlash,
} = require('../../../plugin/bin/lib/wrap-up/evidence-route');

const base = {
  currentBranch: 'worktree-x',
  integrationBranch: 'main',
  toplevel: '/r/wt',
  worktree: '/r/wt/',
  state: 'no-conflict',
  inRun: false,
  leaveOpen: false,
  consoleResolution: null,
};
const decide = (over) => decideEvidenceRoute({ ...base, ...over });

const OPEN_STATES = ['conflicting', 'no-conflict', 'unknown', 'open'];
const UNREADABLE_STATES = ['gh-absent', 'read-failed'];

test('vocabularies are frozen and the safe-name pattern is the contract', () => {
  assert.deepEqual(STATES, ['conflicting', 'no-conflict', 'unknown', 'open', 'not-open', 'no-pr', 'gh-absent', 'read-failed']);
  assert.deepEqual(ROUTES, ['current-branch', 'evidence-pr']);
  assert.ok(Object.isFrozen(STATES) && Object.isFrozen(ROUTES) && Object.isFrozen(REASONS));
  assert.equal(SAFE_BRANCH_RE.source, '^[A-Za-z0-9._/-]+$');
});

test('AC1.1: the integration branch takes evidence-pr whatever the PR state', () => {
  for (const state of STATES) {
    const r = decide({ currentBranch: 'main', state });
    assert.equal(r.route, 'evidence-pr', state);
    assert.equal(r.reason, 'integration-branch', state);
  }
});

test('AC1.1: an empty current branch takes evidence-pr whatever the PR state', () => {
  for (const state of STATES) {
    for (const currentBranch of ['', null, undefined]) {
      const r = decide({ currentBranch, state });
      assert.equal(r.route, 'evidence-pr', state);
      assert.equal(r.reason, 'no-branch', state);
      assert.equal(r.branch, '');
    }
  }
});

test('AC1.1: a branch name outside ^[A-Za-z0-9._/-]+$ takes evidence-pr whatever the PR state', () => {
  for (const state of STATES) {
    for (const currentBranch of ['a$b', 'a b', 'a`b', "a'b"]) {
      const r = decide({ currentBranch, state });
      assert.equal(r.route, 'evidence-pr', `${state} ${currentBranch}`);
      assert.equal(r.reason, 'unsafe-branch-name', `${state} ${currentBranch}`);
    }
  }
});

test('AC1.1: a toplevel that is not the recorded worktree takes evidence-pr whatever the PR state', () => {
  for (const state of STATES) {
    for (const toplevel of ['/r/main', null]) {
      const r = decide({ toplevel, state });
      assert.equal(r.route, 'evidence-pr', `${state} ${toplevel}`);
      assert.equal(r.reason, 'not-run-worktree', `${state} ${toplevel}`);
    }
  }
});

test('AC1.1: the worktree match is exact after dropping a trailing slash', () => {
  assert.equal(decide({ toplevel: '/r/wt/', worktree: '/r/wt' }).route, 'current-branch');
  assert.equal(decide({ toplevel: '/r/wt', worktree: '/r/wt/' }).route, 'current-branch');
  assert.equal(decide({ toplevel: '/r/wt2', worktree: '/r/wt' }).reason, 'not-run-worktree');
  assert.equal(decide({ toplevel: '/R/wt', worktree: '/r/wt' }).reason, 'not-run-worktree');
});

test('stripTrailingSlash drops trailing separators and passes a non-string through', () => {
  assert.equal(stripTrailingSlash('/r/wt/'), '/r/wt');
  assert.equal(stripTrailingSlash('C:\\r\\wt\\'), 'C:\\r\\wt');
  assert.equal(stripTrailingSlash('/r/wt'), '/r/wt');
  assert.equal(stripTrailingSlash(null), null);
  assert.equal(stripTrailingSlash(undefined), undefined);
});

test('unresolved integration branch fails closed', () => {
  for (const state of STATES) {
    for (const integrationBranch of [null, '', undefined]) {
      const r = decide({ integrationBranch, state });
      assert.equal(r.route, 'evidence-pr', state);
      assert.equal(r.reason, 'integration-branch-unresolved', state);
    }
  }
});

test("AC2.1: an open run PR takes current-branch on the run's own branch", () => {
  for (const state of OPEN_STATES) {
    const r = decide({ state });
    assert.deepEqual(r, { route: 'current-branch', branch: 'worktree-x', state, reason: 'run-pr-open' });
  }
});

test("AC2.1: no-pr takes current-branch on the run's own branch", () => {
  const r = decide({ state: 'no-pr' });
  assert.deepEqual(r, { route: 'current-branch', branch: 'worktree-x', state: 'no-pr', reason: 'no-pr' });
});

test("AC2.2: with no worktree recorded the current branch counts as the run's own, still under the guard", () => {
  for (const worktree of [null, undefined, '']) {
    const r = decide({ worktree, toplevel: '/anywhere', state: 'no-conflict' });
    assert.equal(r.route, 'current-branch');
    assert.equal(r.reason, 'run-pr-open');
    const g = decide({ worktree, toplevel: '/anywhere', currentBranch: 'main' });
    assert.equal(g.route, 'evidence-pr');
    assert.equal(g.reason, 'integration-branch');
  }
});

test('run PR not-open takes evidence-pr', () => {
  const r = decide({ state: 'not-open' });
  assert.equal(r.route, 'evidence-pr');
  assert.equal(r.reason, 'run-pr-not-open');
  assert.equal(r.state, 'not-open');
});

test("AC3.1: an unreadable state takes current-branch only for an in-run leave-open console on the run's own branch", () => {
  for (const state of UNREADABLE_STATES) {
    for (const over of [
      { inRun: true, consoleResolution: 'leave-open' },
      { inRun: true, leaveOpen: true },
    ]) {
      const r = decide({ state, ...over });
      assert.equal(r.route, 'current-branch', `${state} ${JSON.stringify(over)}`);
      assert.equal(r.reason, 'unreadable-leave-open', `${state} ${JSON.stringify(over)}`);
      assert.equal(r.state, state);
    }
  }
});

test('AC3.2: an unreadable state otherwise takes evidence-pr', () => {
  for (const state of [...UNREADABLE_STATES, 'weird']) {
    for (const over of [
      { inRun: false, consoleResolution: 'leave-open' },
      { inRun: false, leaveOpen: true },
      { inRun: true, consoleResolution: 'merge' },
      { inRun: true, consoleResolution: null },
    ]) {
      const r = decide({ state, ...over });
      assert.equal(r.route, 'evidence-pr', `${state} ${JSON.stringify(over)}`);
      assert.equal(r.reason, 'unreadable-state', `${state} ${JSON.stringify(over)}`);
    }
  }
  assert.equal(decide({ state: 'weird' }).state, 'read-failed');
  assert.equal(decide({ state: undefined }).state, 'read-failed');
});

test('AC3.1: the leave-open exception never overrides the guard', () => {
  const r = decide({ inRun: true, consoleResolution: 'leave-open', state: 'gh-absent', toplevel: '/r/main' });
  assert.equal(r.route, 'evidence-pr');
  assert.equal(r.reason, 'not-run-worktree');
});

test('branchReadState maps every resolvePrState result', () => {
  assert.equal(branchReadState(null), 'no-pr');
  assert.equal(branchReadState('gh-absent'), 'gh-absent');
  assert.equal(branchReadState('network-failure'), 'read-failed');
  assert.equal(branchReadState('invalid-arguments'), 'read-failed');
  assert.equal(branchReadState({ state: 'OPEN', number: 1 }), 'open');
  assert.equal(branchReadState({ state: 'MERGED' }), 'not-open');
  assert.equal(branchReadState({ state: 'CLOSED' }), 'not-open');
  assert.equal(branchReadState({ state: 'DRAFT?' }), 'read-failed');
  assert.equal(branchReadState(42), 'read-failed');
});

test('every returned route, reason and state is in the frozen vocabularies', () => {
  const overs = [];
  for (const state of [...STATES, 'weird']) {
    for (const currentBranch of ['worktree-x', 'main', '', 'a$b']) {
      for (const toplevel of ['/r/wt', '/r/main', null]) {
        for (const worktree of ['/r/wt/', null]) {
          for (const integrationBranch of ['main', null]) {
            for (const [inRun, leaveOpen, consoleResolution] of [[false, false, null], [true, false, 'leave-open'], [true, true, 'merge']]) {
              overs.push({ state, currentBranch, toplevel, worktree, integrationBranch, inRun, leaveOpen, consoleResolution });
            }
          }
        }
      }
    }
  }
  for (const over of overs) {
    const r = decide(over);
    assert.ok(ROUTES.includes(r.route), JSON.stringify(over));
    assert.ok(REASONS.includes(r.reason), JSON.stringify(over));
    assert.ok(STATES.includes(r.state), JSON.stringify(over));
    assert.equal(r.branch, over.currentBranch || '');
  }
});
