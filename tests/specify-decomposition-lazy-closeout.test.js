// tests/specify-decomposition-lazy-closeout.test.js
// Pins #801's fix: SKILL.md's decomposition-mode entry point used to instruct
// reading decomposition-mode.md AND decomposition-mode-closeout.md together in
// one sentence ("Read X ... and Y ...: together the full procedure"), which pulled
// the mechanical Steps 3-9 file (record-mechanics content, delegating onward to
// record-creation.md) into context before decomposition decision-making (Steps
// 1-2.5) even begins. #832 already split the interactive/mechanical content
// across two files, but this SKILL.md entry-point sentence bundled the read of
// both back together, defeating the split's lazy-loading benefit. The fix makes
// the entry point read only decomposition-mode.md, deferring
// decomposition-mode-closeout.md until that file's own trailer hands off to it.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(REPO_ROOT, rel));

const SKILL = 'plugin/skills/specify/SKILL.md';
const DECOMPOSITION_MODE = 'plugin/skills/specify/decomposition-mode.md';

function decompositionModeSection(skillText) {
  const start = skillText.indexOf('## Decomposition mode');
  assert.ok(start !== -1, 'SKILL.md is missing the "## Decomposition mode" heading');
  const nextHeadingIdx = skillText.indexOf('\n## ', start + 1);
  return nextHeadingIdx === -1 ? skillText.slice(start) : skillText.slice(start, nextHeadingIdx);
}

test('SKILL.md decomposition-mode entry point instructs reading decomposition-mode.md only, not both files jointly (#801)', () => {
  const section = decompositionModeSection(read(SKILL));
  assert.match(
    section,
    /Read `decomposition-mode\.md` in this skill's directory now/,
    'entry point must instruct an immediate read of decomposition-mode.md',
  );
  assert.doesNotMatch(
    section,
    /and `decomposition-mode-closeout\.md`[^.]*for the mechanical Steps 3 through 9: together the full procedure/,
    'entry point must not bundle decomposition-mode-closeout.md into the same immediate-read instruction',
  );
});

test('SKILL.md decomposition-mode entry point explicitly defers decomposition-mode-closeout.md (#801)', () => {
  const section = decompositionModeSection(read(SKILL));
  assert.match(
    section,
    /Do not also read `decomposition-mode-closeout\.md` yet/,
    'entry point must explicitly tell the reader not to load decomposition-mode-closeout.md until reached',
  );
});

test('decomposition-mode.md itself hands off to decomposition-mode-closeout.md only at its own trailer (Step 3), not earlier', () => {
  const text = read(DECOMPOSITION_MODE);
  assert.match(
    text,
    /Continue at Step 3 in `decomposition-mode-closeout\.md`/,
    'decomposition-mode.md must hand off to decomposition-mode-closeout.md at its trailer',
  );
});
