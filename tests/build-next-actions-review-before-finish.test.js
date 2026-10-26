'use strict';
// tests/build-next-actions-review-before-finish.test.js — pins #808: /build's
// Next Actions section must never recommend /superpowers:finishing-a-development-branch's
// merge decision ahead of the review/visual-check line. Before this fix, worktree mode
// (the default git strategy) unconditionally swapped the recommended slot onto the
// finish-branch line regardless of whether the change was UI-dependent or whether review
// had run yet — this test freezes that pre-change paragraph as a fixture and proves the
// new pattern discriminates against it (skill-prose-conformance-tests' "prove go-red"
// pattern, [IL-105]).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const buildSkill = readText(path.join(ROOT, 'plugin', 'skills', 'build', 'SKILL.md'));

// The pre-change Next Actions rendering paragraph (#808) — the clause that swapped the
// recommended slot onto the finish-branch line whenever git strategy was worktree.
const PRE_CHANGE_PARAGRAPH = `Once the signals are resolved, render as plain markdown (docs/skill-authoring.md's Skill handoffs convention), one line per applicable signal, bolding whichever line is recommended and suffixing it \`(recommended)\` — normally the review line, chosen per the browser-availability signal above (do not collapse the two branches into always-\`full\`: UI changed AND a browser is available → the full-review line; otherwise → the plain-review line); in worktree mode, the finish-branch line takes the recommended slot instead:`;

// The pre-change table row for the Worktree-mode signal.
const PRE_CHANGE_ROW = '| Worktree mode | `/superpowers:finishing-a-development-branch` — merge, PR, or discard the feature branch **(Recommended in worktree mode)** |';

// One claim per call: the pattern must match the shipped prose AND fail against the
// pre-change text, so a green result proves the regex can actually go red [IL-105].
function assertClaimPinned(pattern, control, missingMessage) {
  assert.match(buildSkill, pattern, missingMessage);
  assert.doesNotMatch(control, pattern, 'pattern must NOT match the pre-change text (proves it can go red)');
}

test('build/SKILL.md Next Actions: recommended slot is always the review line', () => {
  assertClaimPinned(
    /The recommended slot is always the review line/,
    PRE_CHANGE_PARAGRAPH,
    'must state the recommended slot is unconditionally the review line',
  );
});

test('build/SKILL.md Next Actions: finish-branch line is never the recommended slot', () => {
  assertClaimPinned(
    /The finish-branch line is never the recommended slot, in worktree mode or otherwise/,
    PRE_CHANGE_PARAGRAPH,
    'must explicitly rule out the finish-branch line ever being the recommended slot',
  );
});

test('build/SKILL.md Next Actions: worktree-mode row no longer bolds finish-branch as recommended', () => {
  assertClaimPinned(
    /Worktree mode \| `\/superpowers:finishing-a-development-branch` — merge, PR, or discard the feature branch \(never the recommended slot/,
    PRE_CHANGE_ROW,
    'the Worktree-mode table row must not bold finish-branch as recommended',
  );
  assert.doesNotMatch(
    buildSkill,
    /\*\*\(Recommended in worktree mode\)\*\*/,
    'the old bolded "(Recommended in worktree mode)" row must be gone',
  );
});

test('build/SKILL.md Next Actions: the old worktree-mode override clause is fully removed', () => {
  assert.doesNotMatch(
    buildSkill,
    /in worktree mode, the finish-branch line takes the recommended slot instead/,
    'the retired override clause must not survive anywhere in the file',
  );
});

test('build/SKILL.md Next Actions: cites the shared frontend-detection signal (#808)', () => {
  assertClaimPinned(
    /frontend-detection\.md.*Layer 2\/3/,
    PRE_CHANGE_PARAGRAPH,
    'must cite the same surface-detection machinery the record\'s Technical Approach calls for reusing',
  );
});

test('build/SKILL.md Next Actions: frontend-detection citation uses the fully-qualified skill-directory form', () => {
  assertClaimPinned(
    /`\/claude-tweaks:design-wrapper` skill's directory/,
    PRE_CHANGE_PARAGRAPH,
    'must cite frontend-detection.md via the established fully-qualified citation form, not a bare relative path',
  );
});
