'use strict';
// tests/review-polish-disposition-conformance.test.js — pins that
// skills/review/code-mode-steps.md (#2281) documents Step 6.7's write-back of
// a `dispositionByReview` field onto the shared audit cache, and that
// skills/design-wrapper/modes/polish.md documents the matching skip branch in
// its consumption table and Step 5's per-finding loop, so review's
// ceiling-aware routing is authoritative over polish's blind
// suggestion-driven dispatch of the same finding.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REVIEW_STEPS_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'review', 'code-mode-steps.md');
const POLISH_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper', 'modes', 'polish.md');
const reviewSteps = fs.readFileSync(REVIEW_STEPS_PATH, 'utf8');
const polish = fs.readFileSync(POLISH_PATH, 'utf8');

test('Step 6.7 writes dispositionByReview with all five statuses onto the matching cache entry by id', () => {
  assert.ok(reviewSteps.includes('dispositionByReview'), 'code-mode-steps.md must name the dispositionByReview field');
  assert.ok(
    reviewSteps.includes('{status: "applied"|"staged"|"accepted"|"deferred"|"kept-prompt", at: "<ISO timestamp>"}'),
    'must document the exact dispositionByReview field shape with all five statuses'
  );
  assert.ok(reviewSteps.includes('find the matching entry by `id`'), 'must find the cache entry by id');
});

test('Step 6.7 scopes the write-back to source: audit entries only, never craft-critic', () => {
  assert.ok(
    /finding whose source is `audit`/.test(reviewSteps),
    'must scope the write-back to source: audit findings'
  );
  assert.ok(
    reviewSteps.includes('never a `craft-critic`-only entry'),
    'must explicitly exclude craft-critic entries from the write-back'
  );
});

test('Step 6.7 resolves the same cache path review.md Step 5 already documents, never a new derivation', () => {
  assert.ok(
    reviewSteps.includes("resolve the same Primary/Fallback path that file documents"),
    'must resolve the same Primary/Fallback path as review.md Step 5, not re-derive one'
  );
});

test('Step 6.7 is a read-modify-write that never drops other entries\' fields', () => {
  assert.ok(
    reviewSteps.includes('an in-place read-modify-write'),
    'must state the write is a read-modify-write'
  );
  assert.ok(
    reviewSteps.includes("never a blind overwrite that drops other entries' existing fields"),
    'must state other entries are left untouched'
  );
});

test('Step 6.7 maps every routing outcome (auto and interactive) to a dispositionByReview status', () => {
  assert.ok(reviewSteps.includes('AUTO → `applied`'), 'must map AUTO to applied');
  assert.ok(reviewSteps.includes('STAGED → `staged`'), 'must map STAGED to staged');
  assert.ok(reviewSteps.includes('KEPT-PROMPT → `kept-prompt`'), 'must map KEPT-PROMPT to kept-prompt');
  assert.ok(reviewSteps.includes('Fix now → `applied`'), 'must map interactive Fix now to applied');
  assert.ok(reviewSteps.includes('Defer → `deferred`'), 'must map interactive Defer to deferred');
  assert.ok(reviewSteps.includes("Don't fix → `accepted`"), 'must map interactive Don\'t fix to accepted');
});

test('Step 6.7 skips the write when no cache file exists this run', () => {
  assert.ok(
    /skip this write entirely/.test(reviewSteps),
    'must state the write is skipped when the cache is absent'
  );
});

test('polish.md renames the table to four-way and checks dispositionByReview before suggestion', () => {
  assert.ok(polish.includes('Four-way consumption'), 'polish.md must rename the section to Four-way consumption');
  assert.ok(
    polish.includes('checked in this order'),
    'must state the branches are checked in order'
  );
  assert.ok(
    polish.includes('`dispositionByReview` first'),
    'must state the dispositionByReview branch is checked before the suggestion branches'
  );
});

test('polish.md\'s four-way table adds the skip row ahead of the suggestion-driven Command row', () => {
  const skipRowIndex = polish.indexOf('**Skipped entirely**');
  const commandRowIndex = polish.indexOf('**Command** — suggestion-driven dispatch');
  assert.ok(skipRowIndex !== -1, 'must add a Skipped-entirely row');
  assert.ok(commandRowIndex !== -1, 'must keep the Command row');
  assert.ok(skipRowIndex < commandRowIndex, 'the skip row must be checked before the Command row');
});

test('polish.md Step 5 checks the skip condition before reading suggestion, for every finding', () => {
  const step5Index = polish.indexOf('### Step 5: Suggestion-driven dispatch');
  assert.ok(step5Index !== -1, 'Step 5 heading must still exist');
  const step5Body = polish.slice(step5Index);
  const dispositionIndex = step5Body.indexOf('dispositionByReview');
  const suggestionFieldIndex = step5Body.indexOf('its own `suggestion` field names the command');
  assert.ok(dispositionIndex !== -1, 'Step 5 prose must check dispositionByReview');
  assert.ok(suggestionFieldIndex !== -1, 'Step 5 prose must still read suggestion for remaining findings');
  assert.ok(dispositionIndex < suggestionFieldIndex, 'the disposition check must precede the suggestion read in Step 5\'s prose');
});

test('polish.md states a cache with no dispositionByReview on any entry behaves exactly as before (no regression)', () => {
  assert.ok(
    /behaves\s+exactly\s+as\s+it\s+did\s+before\s+this\s+field\s+existed/.test(polish),
    'must state the no-regression guarantee for a cache with no dispositionByReview field'
  );
});

test('polish.md states the precedence: review\'s ceiling-aware routing is authoritative over polish\'s dispatch', () => {
  assert.ok(
    /authoritative\s+over/.test(polish),
    'polish.md must state review\'s routing is authoritative over its own suggestion-driven dispatch'
  );
});

test('cross-references to the renamed table are updated repo-wide (no stale "three-way consumption" citations)', () => {
  const REVIEW_MODE_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper', 'modes', 'review.md');
  const POLISH_EXEC_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'polish-execution.md');
  for (const p of [REVIEW_STEPS_PATH, POLISH_PATH, REVIEW_MODE_PATH, POLISH_EXEC_PATH]) {
    const content = fs.readFileSync(p, 'utf8');
    assert.ok(!/three-way consumption/i.test(content), `${path.basename(p)} must not cite the retired "three-way consumption" name`);
  }
});
