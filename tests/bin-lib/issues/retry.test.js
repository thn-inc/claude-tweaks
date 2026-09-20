'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  attemptFailedCommentBody, countFailedAttempts, hasHitRetryCeiling, hasNegativeEvidenceMarker,
} = require('../../../plugin/bin/lib/issues/retry');

test('attemptFailedCommentBody formats the human-readable retry comment', () => {
  const body = attemptFailedCommentBody({ attemptNumber: 2, reason: 'test gate failed (3 type errors)' });
  assert.strictEqual(body, 'Attempt 2 failed: test gate failed (3 type errors). Claim released, will retry.');
});

test('attemptFailedCommentBody varies its closing line when the ceiling was hit', () => {
  const body = attemptFailedCommentBody({ attemptNumber: 3, reason: 'test gate failed', ceilingHit: true });
  assert.strictEqual(body, 'Attempt 3 failed: test gate failed. Retry ceiling reached — no further automatic retries.');
});

test('countFailedAttempts counts only matching comments', () => {
  const comments = [
    { body: 'Attempt 1 failed: build error. Claim released, will retry.' },
    { body: 'Some unrelated comment' },
    { body: 'Attempt 2 failed: test gate failed. Claim released, will retry.' },
  ];
  assert.strictEqual(countFailedAttempts(comments), 2);
});

test('countFailedAttempts returns 0 for no comments or no matches', () => {
  assert.strictEqual(countFailedAttempts([]), 0);
  assert.strictEqual(countFailedAttempts(undefined), 0);
  assert.strictEqual(countFailedAttempts([{ body: 'unrelated' }]), 0);
});

test('hasHitRetryCeiling is false while the attempt being evaluated is still below the ceiling', () => {
  const oneFailure = [{ body: 'Attempt 1 failed: a. Claim released, will retry.' }];
  // comments reflects only the prior (posted) attempt — the attempt being
  // evaluated is #2, which is below a ceiling of 3.
  assert.strictEqual(hasHitRetryCeiling(oneFailure, 3), false);
});

test('hasHitRetryCeiling is true once the attempt being evaluated reaches the ceiling', () => {
  const twoFailures = [
    { body: 'Attempt 1 failed: a. Claim released, will retry.' },
    { body: 'Attempt 2 failed: b. Claim released, will retry.' },
  ];
  // comments reflects the 2 prior (posted) attempts — the attempt being
  // evaluated is #3, which equals a ceiling of 3.
  assert.strictEqual(hasHitRetryCeiling(twoFailures, 3), true);
});

test('hasHitRetryCeiling defaults the ceiling to 3', () => {
  const twoFailures = [
    { body: 'Attempt 1 failed: a. Claim released, will retry.' },
    { body: 'Attempt 2 failed: b. Claim released, will retry.' },
  ];
  assert.strictEqual(hasHitRetryCeiling(twoFailures), true);
});

test('hasHitRetryCeiling respects a custom ceiling', () => {
  // No prior comments — the attempt being evaluated is #1, which already
  // equals a ceiling of 1 (no retries permitted after the first attempt).
  assert.strictEqual(hasHitRetryCeiling([], 1), true);
  assert.strictEqual(hasHitRetryCeiling([], 3), false);
});

// Regression test for the off-by-one finding: hasHitRetryCeiling must agree
// with skills/dispatch/SKILL.md's inline `attemptNumber >= ceiling` check
// (Settle step) when given the same comments fetched before this attempt's
// own comment is posted — the exact failure_scenario the finding describes.
test('hasHitRetryCeiling matches the attemptNumber >= ceiling formula dispatch/SKILL.md inlines', () => {
  const comments = [
    { body: 'Attempt 1 failed: a. Claim released, will retry.' },
    { body: 'Attempt 2 failed: b. Claim released, will retry.' },
  ];
  const ceiling = 3;
  const attemptNumber = countFailedAttempts(comments) + 1;
  assert.strictEqual(attemptNumber, 3);
  assert.strictEqual(hasHitRetryCeiling(comments, ceiling), attemptNumber >= ceiling);
  assert.strictEqual(hasHitRetryCeiling(comments, ceiling), true);
});

// --- Negative-evidence marker (#268) ---------------------------------------

test('attemptFailedCommentBody embeds the negative-evidence marker for a correctness classification', () => {
  const body = attemptFailedCommentBody({
    attemptNumber: 1, reason: 'wrong output shape', classification: 'correctness',
  });
  assert.match(body, /^Attempt 1 failed: wrong output shape\. Claim released, will retry\./);
  assert.match(body, /<!-- trust-negative-evidence: attempt=1 classification=correctness -->$/);
});

test('attemptFailedCommentBody embeds the marker for an ambiguous classification too', () => {
  const body = attemptFailedCommentBody({
    attemptNumber: 2, reason: 'unclear failure', classification: 'ambiguous', ceilingHit: true,
  });
  assert.match(body, /<!-- trust-negative-evidence: attempt=2 classification=ambiguous -->$/);
});

test('attemptFailedCommentBody writes no marker for a transient classification', () => {
  const body = attemptFailedCommentBody({
    attemptNumber: 1, reason: 'CI runner timed out', classification: 'transient',
  });
  assert.strictEqual(body, 'Attempt 1 failed: CI runner timed out. Claim released, will retry.');
  assert.doesNotMatch(body, /trust-negative-evidence/);
});

test('attemptFailedCommentBody writes no marker when classification is omitted (pre-#268 callers)', () => {
  const body = attemptFailedCommentBody({ attemptNumber: 1, reason: 'build error' });
  assert.doesNotMatch(body, /trust-negative-evidence/);
});

test('hasNegativeEvidenceMarker reads a correctness marker back from comments', () => {
  const comments = [{ body: attemptFailedCommentBody({ attemptNumber: 1, reason: 'x', classification: 'correctness' }) }];
  assert.strictEqual(hasNegativeEvidenceMarker(comments), true);
});

test('hasNegativeEvidenceMarker reads an ambiguous marker back from comments', () => {
  const comments = [{ body: attemptFailedCommentBody({ attemptNumber: 1, reason: 'x', classification: 'ambiguous' }) }];
  assert.strictEqual(hasNegativeEvidenceMarker(comments), true);
});

test('hasNegativeEvidenceMarker is false for a transient-classified comment', () => {
  const comments = [{ body: attemptFailedCommentBody({ attemptNumber: 1, reason: 'x', classification: 'transient' }) }];
  assert.strictEqual(hasNegativeEvidenceMarker(comments), false);
});

test('hasNegativeEvidenceMarker is false with no comments, undefined, or unrelated comments', () => {
  assert.strictEqual(hasNegativeEvidenceMarker([]), false);
  assert.strictEqual(hasNegativeEvidenceMarker(undefined), false);
  assert.strictEqual(hasNegativeEvidenceMarker([{ body: 'unrelated' }]), false);
});

test('idempotency: two failed attempts on the same record still read as present (not counted)', () => {
  // AC4: settle can run more than once for the same record (retry ceiling) —
  // the reading side is presence-only, so N markers never inflate a count.
  const comments = [
    { body: attemptFailedCommentBody({ attemptNumber: 1, reason: 'a', classification: 'correctness' }) },
    { body: attemptFailedCommentBody({ attemptNumber: 2, reason: 'b', classification: 'ambiguous' }) },
  ];
  assert.strictEqual(hasNegativeEvidenceMarker(comments), true);
});

// #1963: countFailedAttempts is source-agnostic — settle-and-merge.md's
// caller now merges the issue's comments with every PR ever linked to the
// record (open or closed) before counting, so a record whose attempts
// were split across a closed PR and the issue (record #1302's failure
// mode) is still counted correctly once the arrays are merged.
test('countFailedAttempts counts attempts spread across one issue and two closed PRs once merged', () => {
  const issueComments = [{ body: 'Attempt 1 failed: build error. Claim released, will retry.' }];
  const closedPr1Comments = [{ body: 'Attempt 2 failed: test gate failed. Claim released, will retry.' }];
  const closedPr2Comments = [{ body: 'Attempt 3 failed: blocked dependency. Retry ceiling reached — no further automatic retries.' }];
  const merged = [...issueComments, ...closedPr1Comments, ...closedPr2Comments];
  assert.strictEqual(countFailedAttempts(merged), 3);
});
