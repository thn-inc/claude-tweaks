// tests/tidy-housekeeping-pr-check-wait-conformance.test.js — pins #4467: tidy's Step 7.5
// pr-first housekeeping PR screens its body for closing keywords before `gh pr create` (a
// failed screen opens no PR and never takes the local-merge fall-through), and its creation-
// time arm runs _shared/pr-first-merge.md Step 2.5's merge-verification gate before Step 3's
// fences, so an unprotected repo's PR waits on its checks unless the lever resolves `off`.
// Reads live skill prose; each assert has a go-red control run on the text with its block
// sliced out.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const STEP75 = readText(path.join(SKILLS, 'tidy', 'step-7-5-worktree-always.md'));
const PR_FIRST = readText(path.join(SKILLS, '_shared', 'pr-first-merge.md'));

const SCREEN_CALL = 'bin/closing-links.js" --mode screen --body-file';
const SCREEN_FAIL_REPORT = 'PR NOT opened — closing-keyword screen failed';
const ARM_ANCHOR = '**Arm before `ExitWorktree`**';
const CREATION_CALLER = '**Creation-time caller:**';

function armParagraph(text) {
  const s = text.indexOf(ARM_ANCHOR);
  assert.notEqual(s, -1, 'arm paragraph anchor missing');
  const e = text.indexOf('\n\n', s);
  return text.slice(s, e === -1 ? text.length : e);
}

function assertScreenBeforeCreate(text) {
  const at = text.indexOf(SCREEN_CALL);
  assert.notEqual(at, -1, `step-7-5 lacks ${SCREEN_CALL}`);
  const create = text.indexOf('before `gh pr create`', text.lastIndexOf('. ', at));
  assert.ok(create !== -1 && create < at, 'the screen sentence must say it runs before `gh pr create`');
}

function assertScreenFailureStops(text) {
  const at = text.indexOf(SCREEN_FAIL_REPORT);
  assert.notEqual(at, -1, `step-7-5 lacks the report line ${SCREEN_FAIL_REPORT}`);
  const s = text.lastIndexOf(SCREEN_CALL, at);
  assert.ok(s !== -1, 'the screen-failure stop must follow the screen call');
  const clause = text.slice(s, at);
  assert.ok(clause.includes('never the `local-merge` fall-through'), 'a failed screen must not take the local-merge fall-through');
  assert.ok(clause.includes('no `gh pr create`'), 'a failed screen must not create the PR');
}

function assertArmCitesStep25(text) {
  const arm = armParagraph(text);
  const step25 = arm.indexOf('`_shared/pr-first-merge.md` Step 2.5');
  const step3 = arm.indexOf("Step 3's");
  assert.ok(step25 !== -1, 'arm paragraph must cite pr-first-merge.md Step 2.5');
  assert.ok(step3 !== -1 && step25 < step3, 'Step 2.5 must run before Step 3\'s fences');
  assert.ok(arm.includes('leave unarmed'), 'Step 2.5 stops leave the PR unarmed');
  assert.ok(arm.includes('no record to park'), 'the Red path park substitution is stated');
  assert.ok(arm.includes('`off`'), 'the arm obeys the resolved merge-verification value, off included (plan-review Q1)');
  assert.equal(arm.includes('never an immediate merge (checks pending)'), false, 'the blind --auto claim is retired');
}

function assertCreationCallerCitesStep25(text) {
  const s = text.indexOf(CREATION_CALLER);
  assert.notEqual(s, -1, 'Creation-time caller line missing');
  const line = text.slice(s, text.indexOf('\n', s));
  assert.ok(line.includes('Step 2.5'), 'Creation-time caller must name Step 2.5');
}

function cut(text, start, end) {
  const s = text.indexOf(start);
  assert.notEqual(s, -1, `go-red anchor missing: ${start}`);
  const e = end === null ? s + start.length : text.indexOf(end, s);
  return text.slice(0, s) + text.slice(e);
}

test('AC1.1: step-7-5 screens the housekeeping PR body before gh pr create', () => {
  assertScreenBeforeCreate(STEP75);
});

test('AC1.1: a failed screen opens no PR and never takes the local-merge fall-through (plan-review Q2)', () => {
  assertScreenFailureStops(STEP75);
});

test('AC1.1: the creation-time arm runs the merge-verification gate before Step 3 (plan-review Q1)', () => {
  assertArmCitesStep25(STEP75);
  assertCreationCallerCitesStep25(PR_FIRST);
});

test('go-red controls: each assert fails with its block removed', () => {
  assert.throws(() => assertScreenBeforeCreate(cut(STEP75, SCREEN_CALL, null)));
  assert.throws(() => assertScreenFailureStops(cut(STEP75, SCREEN_FAIL_REPORT, null)));
  assert.throws(() => assertArmCitesStep25(STEP75.replace('`_shared/pr-first-merge.md` Step 2.5', 'Step 3')));
  assert.throws(() => assertArmCitesStep25(STEP75.replace(ARM_ANCHOR, `${ARM_ANCHOR} never an immediate merge (checks pending)`)));
  const line = PR_FIRST.slice(PR_FIRST.indexOf(CREATION_CALLER), PR_FIRST.indexOf('\n', PR_FIRST.indexOf(CREATION_CALLER)));
  assert.throws(() => assertCreationCallerCitesStep25(PR_FIRST.replace(line, CREATION_CALLER)));
});
