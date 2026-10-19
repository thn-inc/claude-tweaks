'use strict';
// A returns-nothing search is run once against a tree that still holds its target before it is pinned (#3571, after #3536's AC1.1).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const CHECKS = readText(
  path.join(__dirname, '..', 'plugin/skills/build/plan-authoring-checks.md'));
const TEMPLATE = readText(
  path.join(__dirname, '..', 'plugin/skills/specify/spec-template.md'));
const REFLECT = readText(
  path.join(__dirname, '..', 'plugin/skills/reflect/SKILL.md'));
const LEFTOVER = readText(
  path.join(__dirname, '..', 'plugin/skills/wrap-up/leftover-routing.md'));
const LEDGER = readText(
  path.join(__dirname, '..', 'plugin/skills/_shared/ledger-format.md'));

function acSection() {
  const start = TEMPLATE.indexOf('## Acceptance Criteria\n');
  const end = TEMPLATE.indexOf('## Release Note', start);
  assert.ok(start >= 0 && end > start, 'spec-template.md must have ## Acceptance Criteria followed by ## Release Note');
  return TEMPLATE.slice(start, end);
}

function tombstoneSection() {
  const start = TEMPLATE.indexOf('## Delete + Tombstone Acceptance Criteria\n');
  assert.ok(start >= 0, 'spec-template.md must have ## Delete + Tombstone Acceptance Criteria');
  const end = TEMPLATE.indexOf('\n## ', start + 1);
  assert.ok(end > start, 'the tombstone section must be followed by another ## heading');
  return TEMPLATE.slice(start, end);
}

test('plan-authoring-checks carries the Absence-grep control check exactly once', () => {
  assert.equal(CHECKS.split('Absence-grep control check').length - 1, 1);
  const start = CHECKS.indexOf('**Absence-grep control check');
  assert.ok(start >= 0, 'the bold lead must be present');
  const end = CHECKS.indexOf('\n\n', start);
  const paragraph = CHECKS.slice(start, end);
  assert.ok(paragraph.includes('#3536'), 'the paragraph must cite #3536');
  assert.ok(paragraph.includes('Prefer `grep -F`'), 'the paragraph must name the grep -F remedy');
  assert.ok(paragraph.includes('run that exact command once against a file or commit that still contains the target and confirm it matches'));
  assert.ok(paragraph.includes('pipe `git show {base}:{path}` into the same search'), 'the paragraph must say how to run the control against a commit');
});

test('the AC template asks for a matching run before any returns-nothing criterion', () => {
  const ac = acSection();
  assert.ok(ac.includes('names a command its author has run once against a tree that still contains the target and seen match'));
  assert.ok(ac.includes('prefer `grep -F` for literal code text'));
});

test('the tombstone section treats its scoped grep as an absence grep', () => {
  assert.ok(tombstoneSection().includes('Either way the grep, scoped or bare, is an absence grep: run it once against the pre-deletion tree and confirm it matches the symbol'));
});

test('reflect maps a returns-nothing outcome to a pre-run search', () => {
  assert.ok(REFLECT.includes('an outcome stated as a search that returns nothing is one the author has run against a tree that still holds the target and seen match, using `grep -F` for literal code text'));
});

test('leftover routing asks for a matching run before a returns-nothing grep AC', () => {
  assert.ok(LEFTOVER.includes('a grep asserting that nothing matches is first run against a tree that still holds its target and seen to match'));
});

test('the ledger resolve gate asks for a matching run before a returns-nothing grep AC', () => {
  assert.ok(LEDGER.includes('a grep asserting that nothing matches is first run against a tree that still holds its target and seen to match'));
});
