// tests/verification-skip-before-execute.test.js
//
// Pins #2527's fix: test/verification.md's Step 2 must present the
// Skip-if-recent check BEFORE the imperative "run the runner" instruction,
// not as a subsection discovered only after Step 2's Execute command has
// already been read. Before this fix, "### Skip-if-recent" sat between
// "### Suite-count regression caveat" and "### Re-verify scoping" — well
// after Step 2's own "Run every resolved check through the deterministic
// runner" line — so a caller reading the doc top-to-bottom would hit the
// imperative to run the full suite before ever reaching the guidance that
// says to skip it. #2527 reproduced this from a real /flow build->test
// run's events.jsonl: build and test both ran a full verify at the same
// sha, moments apart, in the same conversation.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('verification.md: Skip-if-recent is checked before the runner is invoked, not after (#2527)', () => {
  const text = read('plugin/skills/test/verification.md');

  const stepTwoIdx = text.indexOf('## Step 2: Execute');
  const skipHeadingIdx = text.indexOf('### Skip-if-recent (for /flow pipelines)');
  const runnerInvocationIdx = text.indexOf(
    'node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --run "$PIPELINE_RUN_DIR" --cmd types="tsc --noEmit"'
  );
  const suiteCountCaveatIdx = text.indexOf('### Suite-count regression caveat (#881)');

  assert.ok(stepTwoIdx !== -1, 'Step 2 heading must exist');
  assert.ok(skipHeadingIdx !== -1, 'Skip-if-recent heading must exist');
  assert.ok(runnerInvocationIdx !== -1, 'the full-suite runner invocation must exist');
  assert.ok(suiteCountCaveatIdx !== -1, 'Suite-count regression caveat heading must exist');

  // Skip-if-recent must live inside Step 2 (not before it).
  assert.ok(stepTwoIdx < skipHeadingIdx, 'Skip-if-recent must appear under Step 2, not before it');

  // The load-bearing fix: the skip check comes before the runner is told to run.
  assert.ok(
    skipHeadingIdx < runnerInvocationIdx,
    'Skip-if-recent must be read before the runner invocation it is meant to preempt'
  );

  // Regression guard against the pre-fix ordering, where Skip-if-recent sat
  // after the Suite-count regression caveat (itself after the runner
  // invocation) rather than before Step 2's own execute command.
  assert.ok(
    skipHeadingIdx < suiteCountCaveatIdx,
    'Skip-if-recent must not be reordered back to after the Suite-count regression caveat'
  );

  // An explicit "check first" framing sentence must precede the heading,
  // so the doc reads as a gate rather than a caveat.
  const gateIdx = text.indexOf('Before running anything below, check whether verification can be skipped');
  assert.ok(gateIdx !== -1, 'Step 2 must open with an explicit skip-first framing sentence');
  assert.ok(gateIdx < skipHeadingIdx, 'the framing sentence must precede the Skip-if-recent heading');
  assert.ok(gateIdx > stepTwoIdx, 'the framing sentence must be under Step 2');
});
