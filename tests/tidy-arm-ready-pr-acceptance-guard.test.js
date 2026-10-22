'use strict';
// #3877: tidy's `## Arm ready PR` guards on acceptance labeling before it arms a
// record-linked PR. Prose-as-implementation — pin the rule against the live text,
// with a negative control per pin proving the assertion can go red.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p)).replace(/\s+/g, ' ');

const slice = (text, from, to) => {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `section ${from} .. ${to} must exist`);
  return text.slice(a, b);
};

const ACTIONS = read('plugin', 'skills', 'tidy', 'actions-github-issues.md');
const TIDY_SKILL = read('plugin', 'skills', 'tidy', 'SKILL.md');
const PR_FIRST_MERGE = read('plugin', 'skills', '_shared', 'pr-first-merge.md');
const SKILL_GRAPH = read('docs', 'skill-graph.md');

const arm = slice(ACTIONS, '## Arm ready PR', '## Release claim');

// The inserted guard paragraph, located by its bold lead and closing words so the
// negative control removes exactly what this task added.
const GUARD_ADDED = /\*\*Acceptance labeling — record-linked flavor only, before Step 3\.\*\*.*?nothing to label\./;

const GUARD_PINS = [
  /verify\.json/,
  /`acceptance-labeling` row/,
  /pass.{0,12}skip/,
  /read every `spec-\*\/verify\.json`/,
  /dispatch\/close-out\.md` step 3/,
];

test("AC1.1: Arm ready PR names verify.json's acceptance-labeling row before its Step 3 call", () => {
  for (const re of GUARD_PINS) assert.match(arm, re);
  const guardAt = arm.indexOf('`acceptance-labeling` row');
  const stepThreeAt = arm.indexOf("run `_shared/pr-first-merge.md`'s Step 3");
  assert.ok(guardAt >= 0 && stepThreeAt >= 0, 'both the labeling row and the Step 3 call must exist');
  assert.ok(guardAt < stepThreeAt, 'the labeling guard must come before the Step 3 call');
});

test('AC1.1: negative control — removing the guard paragraph fails each pin', () => {
  assert.match(arm, GUARD_ADDED, 'the guard paragraph must be locatable');
  const stripped = arm.replace(GUARD_ADDED, '');
  for (const re of GUARD_PINS) assert.doesNotMatch(stripped, re);
});

test('AC2.1: the "never touches Step 1 … preconditions already hold" claim is gone', () => {
  assert.doesNotMatch(arm, /never touches Step 1/);
  assert.doesNotMatch(arm, /both preconditions already hold/);
});

const HELD_PINS = [
  /demo:pending/,
  /<!-- run-comment: brief -->/,
  /<!-- run-comment: try-it -->/,
  /Trusted authors/,
  /no valid marker or run dir resolves/,
  /is held, not armed/,
  /never run labeling from a tidy sweep/,
  /not armed — acceptance labeling not landed/,
  /\/claude-tweaks:dispatch close-out/,
];

test('AC3.1: a record-linked PR with no verify.json and no demo:pending on its Fixes records is held, not armed', () => {
  for (const re of HELD_PINS) assert.match(arm, re);
});

test('AC3.1: negative control — the held outcome is gone once the guard paragraph is stripped', () => {
  assert.match(arm, GUARD_ADDED, 'the guard paragraph must be locatable');
  const stripped = arm.replace(GUARD_ADDED, '');
  assert.doesNotMatch(stripped, /is held, not armed/);
  assert.doesNotMatch(stripped, /not armed — acceptance labeling not landed/);
});

test('housekeeping-marker flavor is exempt from the guard', () => {
  assert.match(arm, /housekeeping-marker flavor .{0,120}skips this check/);
});

test('Step 7.5 verification template lists the held outcome', () => {
  assert.match(TIDY_SKILL, /Held \(not armed\): PR #\{n\} — acceptance labeling not landed/);
});

test("pr-first-merge Step 1 names tidy's Arm ready PR as a caller that holds instead of labeling", () => {
  const step1 = slice(PR_FIRST_MERGE, '## Step 1:', '## Step 1.5');
  assert.match(step1, /tidy's Arm ready PR holds rather than runs this step/);
  const sentence = step1.match(/Labeling has not landed when.*?reached this merge\./);
  assert.ok(sentence, 'the Step 1 "Labeling has not landed when … reached this merge." sentence must exist');
  assert.match(sentence[0], /tidy's Arm ready PR holds rather than runs this step/);
});

test('skill-graph records the tidy → dispatch/close-out.md edge', () => {
  assert.match(slice(SKILL_GRAPH, '## tidy', '## visual-review'), /\| `dispatch\/close-out\.md` \| .*## Arm ready PR/);
});
