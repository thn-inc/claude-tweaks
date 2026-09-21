// tests/flow-resume-adoption-check.test.js — #2398: a bare resume invocation (a
// `review`/`polish`/`wrap-up`-only step subset with `PIPELINE_RUN_DIR` unset) used to fall
// straight through case 5's creation path, minting a duplicate run directory over a live one.
// Pins the new pre-check steps-and-gates.md's case 5 now runs first: read the record's claim
// state, search for a marked open PR, adopt on an unambiguous single candidate, ask on
// ambiguity, and only fall through to creation when neither signal is found (or `build` IS in
// the step list, which skips the check entirely). Live-reads the prose per the
// skill-prose-conformance-tests convention (see flow-cleanup-only-conformance.test.js).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const STEPS_AND_GATES = fs.readFileSync(
  path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'steps-and-gates.md'), 'utf8',
);

function caseFiveSection() {
  const start = STEPS_AND_GATES.indexOf('5. **Unset**');
  assert.ok(start >= 0, 'case 5 ("5. **Unset**") must exist in steps-and-gates.md');
  // Case 5 runs to the next top-level numbered case-list item or end of the adoption list --
  // there is none after case 5, so bound on the next "## " heading instead.
  const nextHeading = STEPS_AND_GATES.indexOf('\n## ', start);
  return nextHeading >= 0 ? STEPS_AND_GATES.slice(start, nextHeading) : STEPS_AND_GATES.slice(start);
}

test('#2398: case 5 names the pre-check and scopes it to a no-build step subset', () => {
  const section = caseFiveSection();
  assert.match(section, /#2398/);
  assert.match(section, /no `build` in the resolved step list/);
  assert.match(section, /`build` is in the resolved step list.*existing behavior, unchanged/s);
});

test('#2398: the pre-check reuses issue-claims.md claim state, not a new mechanism', () => {
  const section = caseFiveSection();
  assert.match(section, /_shared\/issue-claims\.md/);
  assert.match(section, /Reading claim state/);
});

test('#2398: the pre-check also searches for a marked open PR via the pr-first dual-marker scheme', () => {
  const section = caseFiveSection();
  assert.match(section, /_shared\/pr-early-run-lifecycle\.md/);
  assert.match(section, /claude-tweaks-run:/);
});

test('#2398: an unambiguous single candidate is adopted by exporting PIPELINE_RUN_DIR and re-entering resolution', () => {
  const section = caseFiveSection();
  assert.match(section, /Exactly one candidate run-id found/);
  assert.match(section, /export it as `PIPELINE_RUN_DIR` and re-enter this resolution from the top/);
  assert.match(section, /never mint a second directory alongside it/);
});

test('#2398: an ambiguous signal surfaces an AskUserQuestion with Resume/Start fresh/Cancel options', () => {
  const section = caseFiveSection();
  assert.match(section, /AskUserQuestion/);
  assert.match(section, /"Resume \{run-id\}"/);
  assert.match(section, /"Start fresh"/);
  assert.match(section, /"Cancel"/);
});

test('#2398: no signal found falls through to the unchanged creation path', () => {
  const section = caseFiveSection();
  assert.match(section, /Neither signal is found.*proceed to creation below exactly as before/s);
  assert.match(section, /resolve-run-dir --spec-slug/);
});

test('#2398: candidate run-ids are validated against run-dir-resolution.md\'s shape before adoption', () => {
  const section = caseFiveSection();
  assert.match(section, /_shared\/run-dir-resolution\.md/);
  assert.match(section, /no `\/` or `\.\.`/);
});
