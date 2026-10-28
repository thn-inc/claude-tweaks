'use strict';
// #3942: ratifying a deferral sdd-ruling-* item files a backlog record. The rule
// is stated once, in wrap-up/review-console-appendix.md's sdd-ruling-* bullet,
// and its code twin is console/sdd-ruling.js's SDD_RULING_RATIFY_ACTIONS /
// sddRulingRatifyAction. This pins the two equal (prose-code-twin-pin: iterate
// the frozen object, with a floor, never name its members one by one), and pins
// every other console surface to the deferral ratify's outcome.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const { SDD_RULING_RATIFY_ACTIONS, sddRulingRatifyAction } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'sdd-ruling'));

const ws = (s) => new RegExp(s.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
const read = (rel) => readText(path.join(SKILLS, rel));
const APPENDIX = read('wrap-up/review-console-appendix.md');

function assertRatifyRule(text) {
  const actions = Object.values(SDD_RULING_RATIFY_ACTIONS);
  assert.ok(actions.length >= 2, 'SDD_RULING_RATIFY_ACTIONS must not be emptied');
  for (const action of actions) assert.match(text, ws(`\`${action}\``), `appendix names ratify action ${action}`);
  assert.match(text, ws('Resolution `ratified → #{new record}`'));
  assert.match(text, ws('stages it as `staged/ledger-record-sdd-ruling-{N}.md`'));
  assert.match(text, ws('never `accepted`, never `deferred` without a record number'));
  assert.match(text, ws("the staged file's own `Defer-reason:`"));
}

test('AC1.1 AC2.1 AC3.1: the appendix states the ratify-files-a-record rule for every SDD_RULING_RATIFY_ACTIONS member', () => {
  assertRatifyRule(APPENDIX);
});

test('go-red: the rule check fails when the appendix drops the file-record action', () => {
  assert.throws(() => assertRatifyRule(APPENDIX.split('`file-record`').join('`filed`')));
});

test('go-red: the rule check fails when the appendix drops the ratified → #{new record} outcome', () => {
  assert.throws(() => assertRatifyRule(APPENDIX.split('ratified → #{new record}').join('ratified')));
});

test('AC1.1: the appendix\'s deferral header classifies as file-record, its settled header as accept', () => {
  assert.strictEqual(sddRulingRatifyAction('Ruling: x — why\nDefers: yes\nDefer-reason: genuinely-larger\n\nbody'), SDD_RULING_RATIFY_ACTIONS.FILE_RECORD);
  assert.strictEqual(sddRulingRatifyAction('Ruling: x — why\nDefers: no\n\nbody'), SDD_RULING_RATIFY_ACTIONS.ACCEPT);
});

test('AC1.1: every console surface that ratifies a ruling states or cites the deferral ratify outcome', () => {
  for (const rel of [
    'wrap-up/review-console.md',
    'wrap-up/review-console-interactive.md',
    'flow/multispec-review-console.md',
    '_shared/console-execution.md',
    '_shared/console-on-pr.md',
  ]) {
    assert.match(read(rel), ws('ratified → #'), `${rel} names the deferral ratify outcome`);
  }
});

test('AC3.1: console-execution.md routes a failed ratify filing through --filing-failed', () => {
  assert.match(read('_shared/console-execution.md'), ws('When a deferral ratify\'s record was refused or never created, pass that ruling\'s id in `--filing-failed`'));
});
