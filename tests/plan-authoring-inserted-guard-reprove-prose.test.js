'use strict';
// A fix that inserts an earlier guard re-proves the checks after it (#3988, after #3945's F2 fix wave).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const BUILD = path.join(__dirname, '..', 'plugin/skills/build');
const CHECKS = readText(path.join(BUILD, 'plan-authoring-checks.md'));
const DISPATCH = readText(path.join(BUILD, 'dispatch.md'));
const BOUNDARY = readText(path.join(BUILD, 'plan-authoring-boundary-checks.md'));

const CHECK_LEAD = '**Inserted-guard re-proof check (extends the Guard-branch discrimination check):**';
const DISPATCH_LEAD = '**Downstream re-proof after an inserted guard (#3988).**';

// The plan-authoring rule is its own paragraph; the dispatch rule is one bolded
// instruction inside dispatch.md's long paragraph, ending at the next bold lead.
function section(text, lead, terminator) {
  const start = text.indexOf(lead);
  assert.ok(start >= 0, `missing lead: ${lead}`);
  assert.equal(text.indexOf(lead, start + 1), -1, `lead appears more than once: ${lead}`);
  const end = text.indexOf(terminator, start + lead.length);
  return text.slice(start, end === -1 ? undefined : end);
}

function assertChecksRule(text) {
  const p = section(text, CHECK_LEAD, '\n\n');
  for (const literal of [
    'inserts a precondition guard ahead of an existing check',
    'names each check downstream of the new guard',
    'by mutating that check, not only the new guard',
    '#3945',
  ]) assert.ok(p.includes(literal), `plan-authoring rule lacks: ${literal}`);
  const guardBranch = text.indexOf('**Guard-branch discrimination check (extends the Reachability check):**');
  assert.ok(guardBranch >= 0 && guardBranch < text.indexOf(CHECK_LEAD),
    'the rule must follow the Guard-branch discrimination check it extends');
}

function assertDispatchRule(text) {
  const p = section(text, DISPATCH_LEAD, ' **');
  for (const literal of [
    'every re-review dispatch it composes',
    "the scoped re-review of its final review's fix wave included",
    'inserts a precondition guard ahead of an existing check',
    'names each check downstream of that guard',
    'going red with the check itself mutated, not only the new guard',
    'is not ADDRESSED',
  ]) assert.ok(p.includes(literal), `dispatch rule lacks: ${literal}`);
  const treeImmutability = text.indexOf('**Tree-immutability rule for discrimination checks (#2740).**');
  assert.ok(treeImmutability >= 0 && treeImmutability < text.indexOf(DISPATCH_LEAD),
    'the rule must follow the #2740 tree-immutability instruction it refers to as "the rule above"');
}

test('AC1.1 (#3988): plan-authoring-checks.md carries the inserted-guard re-proof rule', () => {
  assertChecksRule(CHECKS);
});

test('AC1.1 (#3988): dispatch.md tells every SDD re-review to re-prove downstream checks', () => {
  assertDispatchRule(DISPATCH);
});

test('AC2.1 (#3988): each pin goes red without its rule', () => {
  const dropChecks = CHECKS.replace(section(CHECKS, CHECK_LEAD, '\n\n'), '');
  assert.throws(() => assertChecksRule(dropChecks));
  assert.throws(() => assertChecksRule(
    CHECKS.replace('by mutating that check, not only the new guard', 'by mutating the new guard')));
  const dropDispatch = DISPATCH.replace(section(DISPATCH, DISPATCH_LEAD, ' **'), '');
  assert.throws(() => assertDispatchRule(dropDispatch));
  assert.throws(() => assertDispatchRule(
    DISPATCH.replace('going red with the check itself mutated, not only the new guard', 'going red')));
});

test('the cross-boundary checks moved to their sub-file, with a pointer left behind (#3988)', () => {
  assert.ok(CHECKS.includes('**Cross-boundary checks:**'), 'the pointer paragraph must be present');
  assert.ok(CHECKS.includes('`plan-authoring-boundary-checks.md`'), 'the pointer must name the sub-file');
  for (const lead of ['**Producer-freshness check:**', '**Upstream-schema premise check:**']) {
    assert.ok(BOUNDARY.includes(lead), `the sub-file must hold ${lead}`);
    assert.ok(!CHECKS.includes(lead), `${lead} must live only in the sub-file`);
  }
});
