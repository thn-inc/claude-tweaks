'use strict';
// #3877: tidy's `## Arm ready PR` guards on acceptance labeling before it arms a
// record-linked PR. Prose-as-implementation — pin the rule against the live text,
// with negative controls proving the guard-paragraph pins can go red.
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
const STEP_6_AUTO_RAW = readText(path.join(ROOT, 'plugin', 'skills', 'tidy', 'step-6-auto.md'));
const PR_FIRST_MERGE = read('plugin', 'skills', '_shared', 'pr-first-merge.md');
const SKILL_GRAPH = read('docs', 'skill-graph.md');

const arm = slice(ACTIONS, '## Arm ready PR', '## Release claim');

// The inserted guard paragraph, located by its bold lead and closing words so the
// negative control removes exactly what this task added.
const GUARD_ADDED = /\*\*Acceptance labeling — record-linked flavor only, before Step 3\.\*\*.*?nothing to label\./;

function armWithoutGuard() {
  assert.match(arm, GUARD_ADDED, 'the guard paragraph must be locatable');
  return arm.replace(GUARD_ADDED, '');
}

const GUARD_PINS = [
  /verify\.json/,
  /`acceptance-labeling` row/,
  /pass.{0,12}skip/,
  /read every `spec-\*\/verify\.json`/,
  /dispatch\/close-out\.md` step 3/,
  /every file read exists/,
  /validating the run-id as `flow\/claim-targets\.md` validates it/,
  /an empty `Fixes` set or a failed read shows nothing/,
  /log-decision\.js.{0,200}--status SKIP/,
  /Never put an unvalidated marker value or a `verify\.json` string that is not a bare word/,
  /unreadable: \{verify\.json \| labels \| comments\}/,
];

test("AC1.1: Arm ready PR names verify.json's acceptance-labeling row before its Step 3 call", () => {
  for (const re of GUARD_PINS) assert.match(arm, re);
  const guardAt = arm.indexOf('`acceptance-labeling` row');
  const stepThreeAt = arm.indexOf("run `_shared/pr-first-merge.md`'s Step 3");
  assert.ok(guardAt >= 0 && stepThreeAt >= 0, 'both the labeling row and the Step 3 call must exist');
  assert.ok(guardAt < stepThreeAt, 'the labeling guard must come before the Step 3 call');
});

test('AC1.1: negative control — removing the guard paragraph fails each pin', () => {
  const stripped = armWithoutGuard();
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
  /Otherwise do not run Step 3/,
];

test('AC3.1: a record-linked PR with no verify.json and no demo:pending on its Fixes records is held, not armed', () => {
  for (const re of HELD_PINS) assert.match(arm, re);
});

test('AC3.1: negative control — the held outcome is gone once the guard paragraph is stripped', () => {
  const stripped = armWithoutGuard();
  assert.doesNotMatch(stripped, /is held, not armed/);
  assert.doesNotMatch(stripped, /not armed — acceptance labeling not landed/);
  assert.doesNotMatch(stripped, /Otherwise do not run Step 3/);
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
  assert.match(slice(SKILL_GRAPH, '## tidy', '## visual-review'), /\| `dispatch\/close-out\.md` \| [^|]*## Arm ready PR/);
});

test('final review: both "identical execution" claims name the labeling-guard exception', () => {
  assert.match(arm, /except for the record-linked flavor's acceptance-labeling guard/);
  assert.doesNotMatch(arm, /both executed identically once staged and approved — only/);
  const row = STEP_6_AUTO_RAW.match(/\| \*\*Arm ready PR\*\* \(item 9's other granted flavor[^\n]*\n/);
  assert.ok(row, "step-6-auto.md's record-linked Arm ready PR row must exist");
  assert.match(row[0], /acceptance-labeling guard/);
  assert.doesNotMatch(row[0], /— only the tier gate differs/);
});

test('final review: the no-run-dir hold names a reachable path, not bare close-out', () => {
  assert.match(arm, /close-out #\{record\}/);
  assert.match(arm, /close-out stops on the same missing run dir/);
  assert.match(arm, /\/claude-tweaks:demo #\{record\}/);
});
