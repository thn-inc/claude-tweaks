'use strict';
// #3672: wrap-up's Phase 4 renders the phase-trace report after Execute approved actions and its
// Verify execution, because the report's Verdict names facts only execution produces. These pins
// keep SKILL.md's order sentence, the section order, the two dependent Verdict rules (#2550's
// carve-out and #3483's leave-open mergeability), and the console hand-off pointers in agreement.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const WRAP_UP = path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up');
const read = (name) => readText(path.join(WRAP_UP, name));
const flatten = (text) => text.replace(/\s+/g, ' ');

const SKILL = read('SKILL.md');
const TEMPLATE = read('summary-template.md');
const EXEC = read('execution-and-verification.md');
const POINTER_FILES = ['SKILL.md', 'review-console.md', 'review-console-interactive.md', 'review-console-appendix.md', 'standalone-fast-path.md'];

const ORDER = '**Order (#3672).**';
const PLAN_H = '### Plan cleanup actions';
const CONSOLE_H = '### Wrap-Up Review Console';
const EXECUTE_H = '### Execute approved actions';
const REPORT_H = '### The phase-trace report';
const AFTER_PHASE4 = '## Important Notes';

// Go-red controls: a mutation that changes nothing would prove nothing.
function assertMutated(original, mutated) {
  assert.ok(mutated !== original, 'the control must actually mutate the text');
  return mutated;
}

function assertSkillOrder(text) {
  const phase4 = text.indexOf('## Phase 4: CLOSE');
  const order = text.indexOf(ORDER);
  const planAt = text.indexOf(PLAN_H);
  const consoleAt = text.indexOf(CONSOLE_H);
  const executeAt = text.indexOf(EXECUTE_H);
  const reportAt = text.indexOf(REPORT_H);
  assert.ok(phase4 !== -1 && order > phase4 && order < planAt, 'order: the order paragraph opens Phase 4, before its first step');
  assert.ok(planAt < consoleAt && consoleAt < executeAt, 'order: Execute approved actions follows the Review Console');
  assert.ok(executeAt < reportAt, 'order: the phase-trace report follows Execute approved actions');
  const para = flatten(text.slice(order, planAt));
  for (const needle of [
    'plan cleanup, the Wrap-Up Review Console, Execute approved actions (its Verify execution included), then the phase-trace report',
    "the Leave-open mergeability re-check's `mergeability:` line in `decisions.md`",
    'the `wrap-up-engine.js verify` rows the #2550 carve-out reads',
    'A verify exit 3 still renders the report',
  ]) assert.ok(para.includes(needle), `order sentence: missing ${JSON.stringify(needle)}`);
}

function verdictSection(text) {
  const flat = flatten(text);
  const start = flat.indexOf('### Verdict');
  const end = flat.indexOf('### State', start);
  assert.ok(start !== -1 && end > start, 'the ### Verdict section must exist');
  return flat.slice(start, end);
}

function assertVerdictRules(text) {
  const header = flatten(text.slice(0, text.indexOf('```')));
  assert.ok(header.includes('and runs last: after Execute approved actions and its Verify execution'),
    "template header: names the report as Phase 4's last step");
  const verdict = verdictSection(text);
  const carve = verdict.indexOf('(#2550)');
  const leave = verdict.indexOf('(#3483)');
  assert.ok(carve !== -1 && leave > carve, 'both Verdict rules are present, #2550 before #3483');
  const carveRule = verdict.slice(carve, leave);
  const leaveRule = verdict.slice(leave);
  assert.ok(carveRule.includes("These rows come from the Verify execution table that Phase 4's execution step inserted just before this report renders"),
    '#2550: the carve-out reads verify rows that execution produced before the report');
  assert.ok(leaveRule.includes("one `mergeability:` outcome in Phase 4's execution step, which completes before this report renders"),
    '#3483: the mergeability line exists by the time the report renders');
  assert.ok(leaveRule.includes('holds no `mergeability:` line — the re-check did not run — reads "mergeability not re-checked"'),
    '#3483: an absent line means the re-check did not run, not that it has not run yet');
}

function assertExecBlocked(text) {
  assert.ok(flatten(text).includes("surface `BLOCKED — {failing check row(s), verbatim}` in the phase-trace report's Verdict (which renders next, per `SKILL.md`'s Phase 4 order"),
    'verify exit 3: BLOCKED surfaces in the report that renders next, not instead of it');
}

function assertPointer(name, text) {
  assert.doesNotMatch(flatten(text), /(?<!not )proceed (directly )?to the (phase-trace )?report/i,
    `${name}: a console hand-off proceeds to Phase 4's execution step, never straight to the report`);
}

test("AC1: SKILL.md states one Phase 4 order and its sections follow it", () => {
  assertSkillOrder(SKILL);
});

test('AC1: the #2550 and #3483 Verdict rules read facts execution has already produced', () => {
  assertVerdictRules(TEMPLATE);
});

test("AC1: a verify exit 3 surfaces BLOCKED in the report that renders after it", () => {
  assertExecBlocked(EXEC);
});

test("AC1: no console hand-off skips Phase 4's execution step", () => {
  for (const name of POINTER_FILES) assertPointer(name, read(name));
});

test('go-red control: the report moved back ahead of Execute approved actions fails the order pin', () => {
  const executeAt = SKILL.indexOf(EXECUTE_H);
  const reportAt = SKILL.indexOf(REPORT_H);
  const endAt = SKILL.indexOf(AFTER_PHASE4);
  assert.ok(executeAt !== -1 && reportAt > executeAt && endAt > reportAt);
  const swapped = assertMutated(SKILL, SKILL.slice(0, executeAt) + SKILL.slice(reportAt, endAt) + SKILL.slice(executeAt, reportAt) + SKILL.slice(endAt));
  assert.throws(() => assertSkillOrder(swapped), /phase-trace report follows/);
});

test('go-red control: dropping either Verdict anchor fails its own pin', () => {
  const noLeave = assertMutated(TEMPLATE, TEMPLATE.replace('which completes\nbefore this report renders', 'which may run\nafter this report renders'));
  assert.throws(() => assertVerdictRules(noLeave), /#3483/);
  const noCarve = assertMutated(TEMPLATE, TEMPLATE.replace('These rows come from the Verify execution table', 'These rows may come from a later table'));
  assert.throws(() => assertVerdictRules(noCarve), /#2550/);
});

test('go-red control: the old step-14 hand-off fails the pointer pin', () => {
  const original = read('review-console.md');
  const reverted = assertMutated(original, original.replace("14. Proceed to Phase 4's execution step, then the phase-trace report", '14. Proceed to the phase-trace report'));
  assert.throws(() => assertPointer('review-console.md', reverted), /never straight to the report/);
});

test('go-red control: the old SKILL.md fast-path hand-off fails the pointer pin', () => {
  const reverted = assertMutated(SKILL, SKILL.replace("skip the console entirely and proceed to Phase 4's execution step", 'skip the console entirely and proceed to the report'));
  assert.throws(() => assertPointer('SKILL.md', reverted), /never straight to the report/);
});
