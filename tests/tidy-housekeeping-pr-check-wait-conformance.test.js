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
const BODY_FILE = 'pr-early-body-{run-id}.md';
const BODY_PLACEHOLDER = '{pr-early-body-path}';
const ARM_CONFLICT = "Step 2.5's Conflict path";
const ARM_VERBATIM = 'any Step 2.5 or Step 3 stop reason, verbatim';
const ARM_NO_POST_MERGE = 'runs no Step 4 or Step 5 post-merge step';
const ARM_CI_GATE = "Step 2.5's `ci-gate` record calls";

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

function assertScreenNamesBodyFile(text) {
  const at = text.indexOf(SCREEN_CALL);
  assert.notEqual(at, -1, `step-7-5 lacks ${SCREEN_CALL}`);
  const s = text.lastIndexOf('. ', at);
  const e = text.indexOf('. ', at);
  const sentence = text.slice(s === -1 ? 0 : s, e === -1 ? text.length : e);
  assert.ok(sentence.includes(BODY_FILE), `the screen sentence must name the body file ${BODY_FILE}`);
  assert.ok(sentence.includes(`as \`${BODY_PLACEHOLDER}\``), `the resolved path must be pasted as ${BODY_PLACEHOLDER}`);
  assert.ok(sentence.includes('gh pr create --body-file'), 'the screen sentence must say gh pr create reads the same path');
  assert.ok(text.startsWith(`${SCREEN_CALL} "${BODY_PLACEHOLDER}"`, at), `the screen call's --body-file must be ${BODY_PLACEHOLDER}`);
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

function assertArmPlanReviewGaps(text) {
  const arm = armParagraph(text);
  assert.ok(arm.includes(ARM_CONFLICT), "Step 2.5's Conflict path routes leave the PR unarmed (plan review 2026-11-16)");
  assert.ok(arm.includes(ARM_VERBATIM), 'every Step 2.5 or Step 3 stop reason is reported verbatim');
  assert.ok(arm.includes(ARM_NO_POST_MERGE), 'a merged housekeeping PR runs no post-merge step');
  assert.ok(arm.includes(ARM_CI_GATE), "Step 2.5's ci-gate records still run (Reading A)");
}

const HINT_ROUTE = 'only when the route was `false` → no action';
const HINT_NEVER = 'never after a Step 2.5 or Step 3 stop';
const MERGED_OFF = '`PR #{n} opened and merged (merge-verification: off)`';
const CALLER_DEGRADES = 'ready+comment degrades become leave-unarmed';
const HINT_ROUTE_MSG = 'the manual --auto hint is printed only on the `false` route';
const HINT_NEVER_MSG = 'the manual --auto hint is never printed after a Step 2.5 or Step 3 stop';
const MERGED_OFF_MSG = 'a merge under `off` is not reported as "after its checks passed"';
const CALLER_DEGRADES_MSG = 'Creation-time caller must limit leave-unarmed to the ready+comment degrades';

function occurrences(text, lit) {
  return text.split(lit).length - 1;
}

// The Unarmed report's `gh pr merge {n} --auto` hint is itself the blind merge on a repo with no
// required checks, so it must not follow a red-check or timeout stop (final review, #4467).
function assertUnarmedHintGated(text) {
  const arm = armParagraph(text);
  const unarmed = arm.indexOf('Unarmed: `PR #{n} opened, NOT armed');
  const hint = arm.indexOf('`gh pr merge {n} --auto`');
  assert.ok(unarmed !== -1 && hint !== -1 && unarmed < hint, 'the Unarmed report line and its --auto hint must both be in the arm paragraph');
  const between = arm.slice(unarmed, hint);
  assert.ok(occurrences(between, HINT_ROUTE) === 1, HINT_ROUTE_MSG);
  assert.ok(occurrences(between, HINT_NEVER) === 1, HINT_NEVER_MSG);
}

function assertMergedReportNamesOff(text) {
  assert.ok(occurrences(armParagraph(text), MERGED_OFF) === 1, MERGED_OFF_MSG);
}

function creationCallerLine(text) {
  const s = text.indexOf(CREATION_CALLER);
  assert.notEqual(s, -1, 'Creation-time caller line missing');
  return text.slice(s, text.indexOf('\n', s));
}

function assertCreationCallerCitesStep25(text) {
  assert.ok(creationCallerLine(text).includes('Step 2.5'), 'Creation-time caller must name Step 2.5');
}

function assertCreationCallerLimitsDegrades(text) {
  assert.ok(occurrences(creationCallerLine(text), CALLER_DEGRADES) === 1, CALLER_DEGRADES_MSG);
}

// A control that changed nothing proves nothing: require the doctored text to differ, and the
// throw to carry the message of the assertion it was built for.
function expectRed(original, doctored, check, message) {
  assert.notEqual(doctored, original, `control changed nothing: ${message}`);
  assert.throws(() => check(doctored), { message });
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

test('AC1.1: the screen and gh pr create read the same named body file (plan review 2026-11-16)', () => {
  assertScreenNamesBodyFile(STEP75);
});

test('AC1.1: a failed screen opens no PR and never takes the local-merge fall-through (plan-review Q2)', () => {
  assertScreenFailureStops(STEP75);
});

test('AC1.1: the creation-time arm runs the merge-verification gate before Step 3 (plan-review Q1)', () => {
  assertArmCitesStep25(STEP75);
  assertCreationCallerCitesStep25(PR_FIRST);
});

test('AC1.1: the arm leaves Conflict path routes unarmed, reports reasons verbatim, skips post-merge steps and records ci-gate (plan review 2026-11-16)', () => {
  assertArmPlanReviewGaps(STEP75);
});

test('AC1.1: the Unarmed report offers the manual --auto arm only on the `false` route, never after a gate stop', () => {
  assertUnarmedHintGated(STEP75);
});

test('AC1.1: a merge under merge-verification off is reported as such, and the caller line limits leave-unarmed to ready+comment degrades', () => {
  assertMergedReportNamesOff(STEP75);
  assertCreationCallerLimitsDegrades(PR_FIRST);
});

test('go-red controls: the report-line asserts fail with their own clause removed or moved', () => {
  expectRed(STEP75, STEP75.replace(HINT_ROUTE, 'X'), assertUnarmedHintGated, HINT_ROUTE_MSG);
  expectRed(STEP75, STEP75.replace(HINT_NEVER, 'X'), assertUnarmedHintGated, HINT_NEVER_MSG);
  // Move-out: the clause stays in the arm paragraph but leaves the Unarmed report's own span.
  const moved = STEP75.replace(HINT_NEVER, 'X').replace(ARM_ANCHOR, `${ARM_ANCHOR} ${HINT_NEVER}`);
  expectRed(STEP75, moved, assertUnarmedHintGated, HINT_NEVER_MSG);
  expectRed(STEP75, STEP75.replace(MERGED_OFF, 'X'), assertMergedReportNamesOff, MERGED_OFF_MSG);
  expectRed(PR_FIRST, PR_FIRST.replace(CALLER_DEGRADES, 'degrades become leave-unarmed'), assertCreationCallerLimitsDegrades, CALLER_DEGRADES_MSG);
});

test('go-red controls: each assert fails with its block removed', () => {
  assert.throws(() => assertScreenBeforeCreate(cut(STEP75, SCREEN_CALL, null)));
  assert.throws(() => assertScreenFailureStops(cut(STEP75, SCREEN_FAIL_REPORT, null)));
  assert.throws(() => assertArmCitesStep25(STEP75.replace('`_shared/pr-first-merge.md` Step 2.5', 'Step 3')));
  assert.throws(() => assertArmCitesStep25(STEP75.replace(ARM_ANCHOR, `${ARM_ANCHOR} never an immediate merge (checks pending)`)));
  assert.throws(() => assertScreenNamesBodyFile(STEP75.replace(BODY_FILE, 'body.md')));
  assert.throws(() => assertScreenNamesBodyFile(STEP75.replace('gh pr create --body-file', 'gh pr create')));
  assert.throws(() => assertScreenNamesBodyFile(STEP75.replace(`${SCREEN_CALL} "${BODY_PLACEHOLDER}"`, `${SCREEN_CALL} "{body-path}"`)));
  assert.throws(() => assertScreenNamesBodyFile(STEP75.replace(`as \`${BODY_PLACEHOLDER}\``, 'as `{body-path}`')));
  const arm = armParagraph(STEP75);
  for (const lit of [ARM_CONFLICT, ARM_VERBATIM, ARM_NO_POST_MERGE, ARM_CI_GATE]) {
    assert.throws(() => assertArmPlanReviewGaps(STEP75.replace(arm, arm.split(lit).join('X'))), lit);
  }
  const line = creationCallerLine(PR_FIRST);
  assert.throws(() => assertCreationCallerCitesStep25(PR_FIRST.replace(line, CREATION_CALLER)));
});
