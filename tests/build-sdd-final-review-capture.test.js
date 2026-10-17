'use strict';
// tests/build-sdd-final-review-capture.test.js — pins #3386: /build's subagent-strategy
// dispatch procedure (dispatch.md, read by SKILL.md Common Step 2's "subagent" branch) directs
// /superpowers:subagent-driven-development to persist its final whole-branch review to
// `$PIPELINE_RUN_DIR/sdd-final-review.md` before its Finish step deletes the plan's SDD workspace,
// so the review evidence feeding #3381's double-review measurement survives the workspace delete.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');

test('dispatch.md: SDD invocation directs the final-review capture before Finish deletes the workspace (#3386 AC1)', () => {
  assert.match(DISPATCH, /\*\*Persist SDD's final whole-branch review before Finish \(#3386\):\*\*/);
  assert.match(
    DISPATCH,
    /before deleting the plan's workspace, it must write `\$PIPELINE_RUN_DIR\/sdd-final-review\.md` \(the absolute run-directory path, never a worktree-relative one\)/
  );
});

// The four-item check, factored out so the doctored control can run the real assertion on mutated text.
function assertFourItems(text) {
  assert.match(text, /the final reviewer's findings verbatim with their severities/);
  assert.match(text, /the reviewed commit SHA \(HEAD when the final review's package was built\) and that package's base commit/);
  assert.match(text, /the fix wave's commit range \(`FIX_BASE\.\.HEAD`\), or "no fix wave"/);
  assert.match(text, /the scoped re-review's per-finding verdicts verbatim, or "no re-review" when there was no fix wave/);
}

test('dispatch.md: the capture names the four items (#3386 AC1)', () => {
  assertFourItems(DISPATCH);
});

test('dispatch.md: nothing is written for standalone /build or a skipped whole-branch review (#3386 AC2)', () => {
  assert.match(DISPATCH, /Write nothing for a standalone `\/build` \(no `\$PIPELINE_RUN_DIR`\) or when the whole-branch review was skipped/);
});

test('dispatch.md: the capture is evidence, not a gate', () => {
  assert.match(DISPATCH, /nothing blocks on its absence/);
});

test('doctored control: removing the reviewed-commit item turns the AC1 assertion red (#3386 AC3)', () => {
  const doctored = DISPATCH.replace(/the reviewed commit SHA \(HEAD when the final review's package was built\) and that package's base commit; /, '');
  assert.notEqual(doctored, DISPATCH, 'the doctoring replace did not hit — the control is vacuous');
  assert.throws(() => assertFourItems(doctored), assert.AssertionError);
});
