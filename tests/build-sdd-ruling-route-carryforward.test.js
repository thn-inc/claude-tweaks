'use strict';
// tests/build-sdd-ruling-route-carryforward.test.js — pins #5449: /build's carry-forward routes a
// procedural SDD ruling to an audit line (AUTO decision + observation ledger row) instead of staging
// it, and the console appendix states the twin.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const ws = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));

const DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');
const APPENDIX = read('plugin', 'skills', 'wrap-up', 'review-console-appendix.md');

const START = '**Carry-forward commands (#3510).**';
function carryForwardBlock(text) {
  const start = text.indexOf(START);
  assert.notEqual(start, -1, 'carry-forward start');
  const open = text.indexOf('```', start);
  const close = text.indexOf('```', open + 3);
  assert.ok(open !== -1 && close !== -1, 'carry-forward fence');
  return text.slice(start, close + 3);
}

const CHECKS = [
  ['route CLI', /bin\/sdd-ruling-route\.js" --file/],
  ['console branch stage-item', /bin\/stage-item\.js" .*--id "sdd-ruling-\{N\}"/],
  ['audit branch log-decision', /bin\/log-decision\.js" .*--status AUTO/],
];

function assertCarryForward(block) {
  for (const [message, re] of CHECKS) assert.match(block, re, message);
  assert.match(block, /ledger-row .*--status observation/, 'audit branch ledger row');
  assert.match(block, ws('Class: procedural'), 'rubric procedural');
  assert.match(block, ws('Class: behaviour'), 'rubric behaviour');
  assert.match(block, ws('when in doubt'), 'rubric when in doubt');
  assert.match(block, /`sdd-ruling-\{N\}` file/, 'sdd-ruling only');
  assert.match(block, ws('If either exits non-zero, run the `sdd-ruling-{N}` line unchanged'), 'audit fallback');
}

test('AC5.1: the carry-forward names the route CLI, the console branch stage-item call and the audit branch log-decision AUTO call', () => {
  assertCarryForward(carryForwardBlock(DISPATCH));
});

test('AC5.1: each pinned clause can go red', () => {
  const block = carryForwardBlock(DISPATCH);
  const cases = [
    ['route CLI', 'bin/sdd-ruling-route.js'],
    ['console branch stage-item', '--id "sdd-ruling-{N}"'],
    ['audit branch log-decision', '--status AUTO'],
  ];
  for (const [message, token] of cases) {
    const mutated = block.split(token).join('REMOVED');
    assert.notEqual(mutated, block, message);
    assert.throws(() => assertCarryForward(mutated), { message });
  }
});

test('console prose twin: the appendix sdd-ruling bullet names Class: behaviour and the decisions.md audit route', () => {
  assert.match(APPENDIX, ws('`Class: behaviour`'));
  assert.match(APPENDIX, ws('never reach the console'));
  assert.match(APPENDIX, ws('`decisions.md`'));
});
