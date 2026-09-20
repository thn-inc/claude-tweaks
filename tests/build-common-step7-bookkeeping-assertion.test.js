'use strict';
// tests/build-common-step7-bookkeeping-assertion.test.js — pins #2311: a single continuous
// /flow session (build through wrap-up, never re-adopting its own run dir) previously had no
// backstop if a bookkeeping-stamp deny silently left run-state.json missing its `worktree`/`pr`
// fields — flow/steps-and-gates.md's case-3 adoption-recovery backfill only fires when a LATER
// call adopts the run dir from an earlier one, not within one continuous session. Common Step 7
// now runs the same backfill unconditionally, before the phase-exit push.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUILD_SKILL = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'build', 'SKILL.md'), 'utf8');

test('build/SKILL.md: Common Step 7 has a Bookkeeping assertion citing #2311', () => {
  assert.match(BUILD_SKILL, /\*\*Bookkeeping assertion \(`worktree` mode, before the phase-exit push below — #2311\)\.\*\*/);
});

test('build/SKILL.md: bookkeeping assertion checks run-state.json for both worktree and (pr-first) pr fields', () => {
  assert.match(BUILD_SKILL, /if it carries no `worktree` field, run `record-worktree` now/);
  assert.match(BUILD_SKILL, /Under `integration-model: pr-first`, also check for a `pr` field; if absent, run `_shared\/pr-early-run-lifecycle\.md`'s push-and-open-draft-PR procedure now/);
});

test('build/SKILL.md: bookkeeping assertion cites (not restates) steps-and-gates.md\'s case-3 backfill', () => {
  assert.match(BUILD_SKILL, /mirrors `flow\/steps-and-gates\.md`'s case-3 adoption-recovery backfill exactly \(cite it, never restate its mechanics\)/);
});

test('build/SKILL.md: bookkeeping assertion runs unconditionally, not only at run-dir adoption', () => {
  assert.match(BUILD_SKILL, /this check runs unconditionally at the end of every build phase, not only when a later call adopts this run directory from an earlier one/);
});

test('build/SKILL.md: bookkeeping assertion logs only when a backfill actually ran (no-op on a clean pass)', () => {
  assert.match(BUILD_SKILL, /Log a decision entry only when a backfill actually ran/);
  assert.match(BUILD_SKILL, /a clean pass \(both fields already present\) writes nothing/);
});

test('build/SKILL.md: bookkeeping assertion appears before the phase-exit push paragraph', () => {
  const assertionIdx = BUILD_SKILL.indexOf('**Bookkeeping assertion (`worktree` mode');
  const phaseExitIdx = BUILD_SKILL.indexOf('**Phase exit (`worktree` mode, `integration-model: pr-first`');
  assert.ok(assertionIdx > -1 && phaseExitIdx > -1, 'both paragraphs must exist');
  assert.ok(assertionIdx < phaseExitIdx, 'the bookkeeping assertion must run before the phase-exit push');
});
