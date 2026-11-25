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
  assert.match(block, ws('the `observation` ledger row. If either exits'), 'audit order');
  assert.match(block, ws('and only after it succeeds'), 'ledger only after decision');
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

const BULLET_START = '- `apply` on an `sdd-ruling-*` item';
function appendixBullet(text) {
  const start = text.indexOf(BULLET_START);
  assert.notEqual(start, -1, 'appendix bullet start');
  const end = text.indexOf('\n- ', start + 1);
  assert.notEqual(end, -1, 'appendix bullet end');
  return text.slice(start, end);
}
function assertTwin(bullet) {
  assert.match(bullet, ws('`Class: behaviour`'), 'twin Class: behaviour');
  assert.match(bullet, ws('never reach the console'), 'twin never reach the console');
  assert.match(bullet, ws('logged in `decisions.md` as an `AUTO` line'), 'twin decisions.md audit route');
  assert.match(bullet, ws('never staged unless the route or an audit command fails'), 'twin failure fallback');
}

test('console prose twin: the appendix sdd-ruling bullet names Class: behaviour and the decisions.md audit route', () => {
  assertTwin(appendixBullet(APPENDIX));
});

test('console prose twin: each pinned clause can go red', () => {
  const bullet = appendixBullet(APPENDIX);
  const cases = [
    ['twin Class: behaviour', '`Class: behaviour`'],
    ['twin never reach the console', 'never reach the console'],
    ['twin decisions.md audit route', 'logged in `decisions.md`'],
    ['twin failure fallback', 'unless the route or an audit command fails'],
  ];
  for (const [message, token] of cases) {
    const mutated = bullet.split(token).join('REMOVED');
    assert.notEqual(mutated, bullet, message);
    assert.throws(() => assertTwin(mutated), { message });
  }
});
