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

const UNARMED_REPORT = 'Unarmed: `PR #{n} opened, NOT armed';
const MERGED_REPORT = 'Merged: `PR #{n} opened and merged';
const AUTO_COMMAND = '`gh pr merge {n} --auto`';
const POLICY_HINT = '`housekeeping-auto-merge: true` in';
const STAGED_ROUTE = '`true`∧`conservative` → stage an arm proposal';
const ARM_NOW = 'Arm now first runs';
const HINT_ROUTE = 'on the `false` → no action route only';
const HINT_NEVER = 'never a `gh pr merge {n} --auto` command on any route';
const STAGED_GATED = 'whose later apply runs the same Arm now sequence, gate first, never a bare `--auto`';
const MERGED_OFF = '`PR #{n} opened and merged (merge-verification: off)`';
const CALLER_DEGRADES = 'Red path, Conflict path and ready+comment degrades become leave-unarmed';
const REPORT_SPAN_MSG = 'the Merged and Unarmed report lines must both be in the arm paragraph, Merged first';
const HINT_ROUTE_MSG = 'the Unarmed follow-up line is printed only on the `false` route';
const HINT_NEVER_MSG = 'the Unarmed report must say no --auto command is ever printed';
const HINT_LINE_MSG = 'no standalone `gh pr merge {n} --auto` line may follow the Unarmed report';
const STAGED_SPAN_MSG = 'the conservative route and the Arm now sentence must both be in the arm paragraph, in that order';
const STAGED_MSG = 'a staged arm proposal must be applied through the gate, never as a bare --auto';
const MERGED_OFF_MSG = 'a merge under `off` is not reported as "after its checks passed"';
const CALLER_DEGRADES_MSG = 'Creation-time caller must name the Red path, Conflict path and ready+comment degrades as leave-unarmed';

function occurrences(text, lit) {
  return text.split(lit).length - 1;
}

// A printed `gh pr merge {n} --auto` is itself the blind merge on a repo with no required checks,
// on every route: after a gate stop the checks are red or pending, and on the `false` route they
// have only just started (final review, #4467).
function assertUnarmedHintGated(text) {
  const arm = armParagraph(text);
  const unarmed = arm.indexOf(UNARMED_REPORT);
  assert.ok(unarmed !== -1, REPORT_SPAN_MSG);
  const tail = arm.slice(unarmed);
  assert.ok(occurrences(tail, HINT_ROUTE) === 1, HINT_ROUTE_MSG);
  assert.ok(occurrences(tail, HINT_NEVER) === 1, HINT_NEVER_MSG);
  assert.ok(arm.split('\n').every((line) => line.trim() !== AUTO_COMMAND), HINT_LINE_MSG);
}

function assertStagedArmGated(text) {
  const arm = armParagraph(text);
  const staged = arm.indexOf(STAGED_ROUTE);
  const armNow = arm.indexOf(ARM_NOW);
  assert.ok(staged !== -1 && armNow !== -1 && staged < armNow, STAGED_SPAN_MSG);
  assert.ok(occurrences(arm.slice(staged, armNow), STAGED_GATED) === 1, STAGED_MSG);
}

function assertMergedReportNamesOff(text) {
  const arm = armParagraph(text);
  const merged = arm.indexOf(MERGED_REPORT);
  const unarmed = arm.indexOf(UNARMED_REPORT);
  assert.ok(merged !== -1 && unarmed !== -1 && merged < unarmed, REPORT_SPAN_MSG);
  assert.ok(occurrences(arm.slice(merged, unarmed), MERGED_OFF) === 1, MERGED_OFF_MSG);
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

test('AC1.1: the Unarmed report never prints a manual --auto command, and its policy hint is for the `false` route only', () => {
  assertUnarmedHintGated(STEP75);
});

test('AC1.1: a staged arm proposal is applied through the gate, never as a bare --auto', () => {
  assertStagedArmGated(STEP75);
});

test('AC1.1: a merge under merge-verification off is reported as such, and the caller line names every leave-unarmed substitution', () => {
  assertMergedReportNamesOff(STEP75);
  assertCreationCallerLimitsDegrades(PR_FIRST);
});

test('go-red controls: the report-line asserts fail with their own clause removed or moved', () => {
  // Move-out controls keep the clause in the arm paragraph but outside the span its assert reads.
  const moveToAnchor = (lit) => STEP75.replace(lit, 'X').replace(ARM_ANCHOR, `${ARM_ANCHOR} ${lit}`);
  expectRed(STEP75, STEP75.replace(HINT_ROUTE, 'X'), assertUnarmedHintGated, HINT_ROUTE_MSG);
  expectRed(STEP75, STEP75.replace(HINT_NEVER, 'X'), assertUnarmedHintGated, HINT_NEVER_MSG);
  expectRed(STEP75, moveToAnchor(HINT_NEVER), assertUnarmedHintGated, HINT_NEVER_MSG);
  expectRed(STEP75, STEP75.replace(POLICY_HINT, `${AUTO_COMMAND}\n${POLICY_HINT}`), assertUnarmedHintGated, HINT_LINE_MSG);
  expectRed(STEP75, STEP75.replace(STAGED_GATED, 'X'), assertStagedArmGated, STAGED_MSG);
  expectRed(STEP75, STEP75.replace(STAGED_GATED, 'X').replace(ARM_NOW, `${ARM_NOW} ${STAGED_GATED}`), assertStagedArmGated, STAGED_MSG);
  expectRed(STEP75, STEP75.replace(MERGED_OFF, 'X'), assertMergedReportNamesOff, MERGED_OFF_MSG);
  expectRed(STEP75, moveToAnchor(MERGED_OFF), assertMergedReportNamesOff, MERGED_OFF_MSG);
  expectRed(PR_FIRST, PR_FIRST.replace(CALLER_DEGRADES, 'degrades become leave-unarmed'), assertCreationCallerLimitsDegrades, CALLER_DEGRADES_MSG);
  expectRed(PR_FIRST, PR_FIRST.replace('Conflict path and ready+comment degrades', 'ready+comment degrades'), assertCreationCallerLimitsDegrades, CALLER_DEGRADES_MSG);
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
