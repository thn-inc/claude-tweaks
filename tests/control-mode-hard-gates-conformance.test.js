// tests/control-mode-hard-gates-conformance.test.js — #4620. Pins that every
// HARD-GATE on _shared/auto-mode-contract.md's "What `auto` does NOT silence"
// table still stops a control-mode run. [IL-80] carve-out: reads live skill
// prose deliberately — that table is the canonical gate list this record cites,
// and the control-mode section of autonomy-ceiling.md is the sentence under test.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { bookkeepingPermissions } = require('../plugin/bin/lib/issues/autonomy');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const CONTRACT = read('plugin/skills/_shared/auto-mode-contract.md');
const CEILING = read('plugin/skills/_shared/autonomy-ceiling.md');
const READ_PATH = read('plugin/skills/_shared/policy-schema-read-path.md');

// One anchor per gate on the HARD-GATE row, plus the separate merge-conflict row.
const GATES = [
  ['review spec compliance', '`/review` Step 1 spec compliance'],
  ['review test gate', '`/review` Step 1.5 test gate'],
  ['flow design-doc rejection', '`/flow` Step 2.7 design-doc rejection'],
  ['build plan validation', '`/build` Design Step 3 plan validation'],
  ['build plan audit', '`/build` Common Step 1.5 plan audit hard-fails'],
  ['multi-spec boundary freshness', 'multi-spec boundary-freshness escalation'],
  ['release Step 4 gates', "`/release` Step 4's two gates"],
  ['release-block stop', "`/release` Step 1.5's release-block stop"],
  ['test PR-bookkeeping precondition', '`/test` Step 0 (PR-bookkeeping precondition check)'],
  ['adopted-branch collision', 'adopted-branch collision stop'],
  ['plan-review spec gap', 'plan-review needs-human spec gap'],
  ['adopted-run PR-conflict catch-up', 'adopted-run PR-conflict catch-up stop'],
  ['dispatch missing-claim fallback', 'second-call missing-claim fallback'],
  ['unresolvable merge conflict', 'Resolution of merge conflicts in worktree finishing'],
];

function notSilencedRows(contract) {
  const start = contract.indexOf('## What `auto` does NOT silence');
  assert.ok(start !== -1, 'contract: "What `auto` does NOT silence" heading not found');
  const end = contract.indexOf('\n## ', start + 1);
  const body = contract.slice(start, end === -1 ? undefined : end);
  return body.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Item') && !l.startsWith('|---'));
}
function controlModeSection(ceiling) {
  const start = ceiling.indexOf('## Control mode (#4620)');
  assert.ok(start !== -1, 'autonomy-ceiling.md: no `## Control mode (#4620)` heading');
  const end = ceiling.indexOf('\n## ', start + 1);
  return ceiling.slice(start, end === -1 ? undefined : end);
}
function assertGateStops(contract, ceiling, [name, anchor]) {
  const rows = notSilencedRows(contract);
  assert.ok(rows.some((r) => r.includes(anchor)), `${name}: not on the exemption list`);
  const cm = controlModeSection(ceiling);
  assert.match(cm, /What `auto` does NOT silence/, `${name}: control-mode section does not cite the table`);
  assert.match(cm, /merge-conflict resolution row included/, `${name}: merge conflicts not named`);
  assert.match(cm, /Generic gate failure card, never as a question/, `${name}: failure card not named`);
}

for (const gate of GATES) {
  test(`AC6.1: ${gate[0]} still stops under control mode and is reported with the generic failure card`, () => assertGateStops(CONTRACT, CEILING, gate));
}
test('AC6.1 go-red: a gate missing from the contract fails its own assertion', () => {
  const m = CONTRACT.replace('`/review` Step 1.5 test gate', '`/review` test step');
  assert.notStrictEqual(m, CONTRACT);
  assert.throws(() => assertGateStops(m, CEILING, GATES[1]), { message: /review test gate: not on the exemption list/ });
});
test('AC6.1 go-red: dropping the failure-card clause fails', () => {
  const m = CEILING.replace('Generic gate failure card, never as a question', 'a card');
  assert.notStrictEqual(m, CEILING);
  assert.throws(() => assertGateStops(CONTRACT, m, GATES[0]), { message: /failure card not named/ });
});
test('AC6.1 go-red: dropping the merge-conflict row naming fails', () => {
  const m = CEILING.replace('merge-conflict resolution row included', 'rows');
  assert.notStrictEqual(m, CEILING);
  assert.throws(() => assertGateStops(CONTRACT, m, GATES[0]), { message: /merge conflicts not named/ });
});
test('AC6.1: control mode adds no capability that could silence a gate', () => {
  // ownedUpstreamFiling (#4621) is control mode's one deliberate capability; it files into an owned repo, never silences a gate
  const strip = ({ ownedUpstreamFiling, ...rest }) => rest;
  const cm = strip(bookkeepingPermissions(null, { controlMode: true }));
  assert.deepStrictEqual(cm, strip(bookkeepingPermissions('unattended')));
  // controls: the comparison can go red - supervised differs, and a mutated copy fails
  assert.notDeepStrictEqual(cm, strip(bookkeepingPermissions('supervised')));
  const flipped = { ...cm, [Object.keys(cm)[0]]: !Object.values(cm)[0] };
  assert.throws(() => assert.deepStrictEqual(flipped, strip(bookkeepingPermissions('unattended'))));
});

function precedenceRungs(ceiling) {
  const start = ceiling.indexOf('## Precedence');
  assert.ok(start !== -1, 'no Precedence heading');
  const body = ceiling.slice(start, ceiling.indexOf('\n## ', start + 1));
  return ['`config.yml`', '`.claude-tweaks/policy.yml`', '`control-mode: on`', 'Skill default: `supervised`'].map((a) => body.indexOf(a));
}
test('AC4.10: autonomy-ceiling.md Precedence names the control-mode rung below explicit sources', () => {
  const idx = precedenceRungs(CEILING);
  assert.ok(idx.every((i) => i !== -1), `a rung is missing: ${idx}`);
  assert.deepStrictEqual([...idx].sort((a, b) => a - b), idx, 'rungs out of order');
  // control: a permuted copy (control-mode rung inserted above policy.yml, i.e. below config.yml) must be seen as out of order
  const permuted = CEILING.replace('3. `.claude-tweaks/policy.yml`', '3. `control-mode: on` x\n3. `.claude-tweaks/policy.yml`');
  assert.notDeepStrictEqual([...precedenceRungs(permuted)].sort((a, b) => a - b), precedenceRungs(permuted));
});
function assertOwnerCell(readPath) {
  const row = readPath.split('\n').find((l) => l.startsWith('| `control-mode` |'));
  assert.ok(row, 'no control-mode row');
  assert.match(row, /#4620/, 'control-mode owner cell does not name #4620');
}
test('policy-schema-read-path.md names the control-mode owner', () => {
  assertOwnerCell(READ_PATH);
  const m = READ_PATH.replace('(the Review Console\'s carry route and residue convergence, #4620)', '(the Review Console\'s carry route and residue convergence)');
  assert.notStrictEqual(m, READ_PATH);
  assert.throws(() => assertOwnerCell(m), { message: /does not name #4620/ });
});
