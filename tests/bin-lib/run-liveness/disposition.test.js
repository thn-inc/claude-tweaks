'use strict';
// tests/bin-lib/run-liveness/disposition.test.js — #3977: the run disposition
// table, one test per row, plus the unknown-fact and fail-open-fault checks.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  disposition, shapeOf, isReviewFinding, CLOSE_REASONS, STAGED_OUTCOME_REASON, QUIET_FLOOR_MS,
} = require('../../../plugin/bin/lib/run-liveness/disposition');

const DAY = 24 * 60 * 60 * 1000;
const FINDING = 'staged/review-unconfirmed-1.md';
const OTHER = 'staged/reflect-1.md';

// Facts that close a formal run through row 12 (nothing to resume).
function formal(over = {}) {
  return {
    shape: 'formal',
    verdict: 'dead',
    pr: 'none',
    prNumber: null,
    prDraft: null,
    branch: { name: 'feat-x', localExists: false, remoteExists: false, uniqueCommits: 0 },
    worktree: { path: null, exists: false, dirty: false },
    staged: [],
    quietMs: 2 * DAY,
    ...over,
  };
}
const adhoc = (over = {}) => formal({ shape: 'adhoc', ...over });
const standalone = (over = {}) => formal({ shape: 'standalone', ...over });

function check(facts, action, reason) {
  const r = disposition(facts);
  assert.strictEqual(r.action, action, JSON.stringify(r));
  assert.strictEqual(r.reason, reason, JSON.stringify(r));
  return r;
}

test('row 1: a live run is left, whatever its shape', () => {
  for (const f of [adhoc(), standalone(), formal(), formal({ pr: 'closed-unmerged' })]) check({ ...f, verdict: 'live' }, 'leave', 'live');
});

test('row 2: an unknown verdict leaves every shape, even with otherwise-closing facts', () => {
  for (const f of [adhoc(), standalone(), formal(), formal({ pr: 'closed-unmerged' })]) check({ ...f, verdict: 'unknown' }, 'leave', 'verdict-unknown');
  check(formal({ verdict: undefined }), 'leave', 'verdict-unknown');
});

test('row 3: a dead ad hoc run with staged ok closes', () => {
  check(adhoc(), 'close', 'adhoc-dead');
  check(adhoc({ staged: [FINDING] }), 'close', 'adhoc-dead');
});

test('row 4: a dead ad hoc run with other staged is an orphan', () => {
  check(adhoc({ staged: [OTHER] }), 'orphan', STAGED_OUTCOME_REASON);
});

test('row 5: a dead standalone run with empty staged closes', () => {
  check(standalone(), 'close', 'standalone-dead');
});

test('row 6: a dead standalone run with any staged item is left', () => {
  check(standalone({ staged: [FINDING] }), 'leave', 'standalone-staged');
});

test('row 7: a formal run with a merged PR is left to the merged path', () => {
  check(formal({ pr: 'merged', prNumber: 5 }), 'leave', 'pr-merged');
});

test('row 8: a dead formal run with a closed-unmerged PR and staged ok closes and lists its findings', () => {
  const r = check(formal({ pr: 'closed-unmerged', prNumber: 7, staged: [FINDING, 'spec-2/staged/review-debate-3.md'] }), 'close', 'pr-closed-unmerged');
  assert.deepStrictEqual(r.dropFindings, [FINDING, 'spec-2/staged/review-debate-3.md']);
  assert.strictEqual(r.evidence.verdict, 'dead');
  assert.strictEqual(r.evidence.prNumber, 7);
});

test('row 9: a closed-unmerged PR with other staged is an orphan', () => {
  check(formal({ pr: 'closed-unmerged', staged: [FINDING, OTHER] }), 'orphan', STAGED_OUTCOME_REASON);
});

test('row 10: an open PR is an orphan, draft or ready', () => {
  check(formal({ pr: 'open', prNumber: 12, prDraft: true }), 'orphan', 'draft PR #12, session gone');
  check(formal({ pr: 'open', prNumber: 12, prDraft: false }), 'orphan', 'PR #12 open, session gone');
  check(formal({ pr: 'open', prNumber: 12, prDraft: null }), 'orphan', 'PR #12 open, session gone');
});

test('row 11: unpushed commits or a dirty worktree make a no-PR run an orphan', () => {
  check(formal({ branch: { name: 'feat-x', localExists: true, remoteExists: false, uniqueCommits: 3 } }), 'orphan', 'unpushed commits on feat-x');
  check(formal({ worktree: { path: '/wt/x', exists: true, dirty: true } }), 'orphan', 'uncommitted changes in /wt/x');
});

test('row 12: a dead no-PR run with nothing to resume, quiet past 24h and staged ok closes', () => {
  check(formal(), 'close', 'nothing-to-resume');
  check(formal({ branch: { name: 'b', localExists: true, remoteExists: true, uniqueCommits: 0 }, worktree: { path: '/wt', exists: true, dirty: false } }), 'close', 'nothing-to-resume');
  const r = check(formal({ staged: [FINDING] }), 'close', 'nothing-to-resume');
  assert.deepStrictEqual(r.dropFindings, [FINDING]);
});

test('row 13: as row 12 but other staged is an orphan', () => {
  check(formal({ staged: [OTHER] }), 'orphan', STAGED_OUTCOME_REASON);
});

test('row 14: anything else is left', () => {
  check(formal({ quietMs: DAY }), 'leave', 'default');
  check(formal({ shape: 'mystery' }), 'leave', 'default');
});

test('quiet under 24h leaves', () => {
  check(formal({ quietMs: QUIET_FLOOR_MS }), 'leave', 'default');
  check(formal({ quietMs: null }), 'leave', 'default');
});

test('pr unknown leaves even when every other fact says close', () => {
  check(formal({ pr: 'unknown' }), 'leave', 'default');
  check(formal({ pr: undefined }), 'leave', 'default');
});

test('uniqueCommits null leaves', () => {
  check(formal({ branch: { name: 'b', localExists: true, remoteExists: false, uniqueCommits: null } }), 'leave', 'default');
});

test('dirty null leaves', () => {
  check(formal({ worktree: { path: '/wt', exists: true, dirty: null } }), 'leave', 'default');
  check(formal({ worktree: { path: '/wt', exists: null, dirty: null } }), 'leave', 'default');
});

test('non-boolean ref facts leave', () => {
  check(formal({ branch: { name: 'b', localExists: null, remoteExists: false, uniqueCommits: null } }), 'leave', 'default');
});

test('unreadable staged entry is other staged', () => {
  check(adhoc({ staged: ['staged/ (unreadable: EACCES)'] }), 'orphan', STAGED_OUTCOME_REASON);
  check(formal({ pr: 'closed-unmerged', staged: ['staged/ (unreadable: EIO)'] }), 'orphan', STAGED_OUTCOME_REASON);
  check(adhoc({ staged: null }), 'orphan', STAGED_OUTCOME_REASON);
});

test('CLOSE_REASONS lists exactly the close reasons', () => {
  const closing = [adhoc(), standalone(), formal({ pr: 'closed-unmerged' }), formal()].map((f) => disposition(f));
  assert.ok(closing.every((r) => r.action === 'close'));
  assert.deepStrictEqual([...CLOSE_REASONS].sort(), closing.map((r) => r.reason).sort());
});

test('shapeOf and isReviewFinding', () => {
  assert.strictEqual(shapeOf('/p/2026-10-01T000000-adhoc-standalone'), 'adhoc');
  assert.strictEqual(shapeOf('/p/2026-10-01T000000-tidy-standalone'), 'standalone');
  assert.strictEqual(shapeOf('/p/2026-10-01T000000-release-standalone'), 'standalone');
  assert.strictEqual(shapeOf('/p/2026-10-01T000000-dispatch-standalone'), 'standalone');
  assert.strictEqual(shapeOf('/p/2026-10-01T000000-record-12'), 'formal');
  assert.ok(isReviewFinding('staged/review-contested-2.md'));
  assert.ok(!isReviewFinding('staged/reflect-1.md'));
  assert.ok(!isReviewFinding('staged/x.shadow-dup'));
});

// AC3: fail-open faults the tests above must catch.
const UNKNOWN_VERDICT_CASES = [adhoc(), standalone(), formal(), formal({ pr: 'closed-unmerged' })]
  .map((f) => ({ facts: { ...f, verdict: 'unknown' }, action: 'leave' }));
const UNKNOWN_PR_CASES = [formal({ pr: 'unknown' })].map((facts) => ({ facts, action: 'leave' }));

function assertCases(fn, cases) {
  for (const c of cases) assert.strictEqual(fn(c.facts).action, c.action, JSON.stringify(c.facts));
}

test('fault injection: treating verdict unknown as dead fails the unknown-verdict cases', () => {
  const failOpenVerdict = (f) => disposition({ ...f, verdict: f.verdict === 'unknown' ? 'dead' : f.verdict });
  assertCases(disposition, UNKNOWN_VERDICT_CASES);
  assert.throws(() => assertCases(failOpenVerdict, UNKNOWN_VERDICT_CASES), assert.AssertionError);
});

test('fault injection: treating pr unknown as none fails the unknown-pr cases', () => {
  const failOpenPr = (f) => disposition({ ...f, pr: f.pr === 'unknown' ? 'none' : f.pr });
  assertCases(disposition, UNKNOWN_PR_CASES);
  assert.throws(() => assertCases(failOpenPr, UNKNOWN_PR_CASES), assert.AssertionError);
});
