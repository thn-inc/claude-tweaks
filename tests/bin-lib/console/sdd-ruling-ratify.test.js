'use strict';
// #3942: sddRulingRatifyAction — what ratifying an sdd-ruling-* item does.
// A safe deferral files a backlog record (file-record); a settled Defers: no
// ruling keeps the accepted write-back (accept); a ruling the gate withholds
// is not ratifiable at all (null).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { SDD_RULING_RATIFY_ACTIONS, sddRulingRatifyAction } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'console', 'sdd-ruling'));

const ruling = (header) => `Ruling: Task 2: defer the guard — cheaper\n${header}\nratify / reverse\n`;

test('AC1.1: Defers: yes + one valid Defer-reason ratifies as file-record', () => {
  assert.strictEqual(sddRulingRatifyAction(ruling('Defers: yes\nDefer-reason: genuinely-larger\n')), 'file-record');
});

test('AC1.1: a Defer-reason line alone (no Defers:) ratifies as file-record', () => {
  assert.strictEqual(sddRulingRatifyAction(ruling('Defer-reason: tangential\n')), 'file-record');
});

test('Defers: no plus a valid Defer-reason is a deferral — file-record, not accept', () => {
  assert.strictEqual(sddRulingRatifyAction(ruling('Defers: no\nDefer-reason: pre-existing-outside-diff\n')), 'file-record');
});

test('AC2.1: Defers: no with no Defer-reason ratifies as accept', () => {
  assert.strictEqual(sddRulingRatifyAction(ruling('Defers: no\n')), 'accept');
});

test('not ratifiable: a no-reason deferral, an invalid reason, an unclassified header and null text all return null', () => {
  assert.strictEqual(sddRulingRatifyAction(ruling('Defers: yes\n')), null);
  assert.strictEqual(sddRulingRatifyAction(ruling('Defers: yes\nDefer-reason: minor\n')), null);
  assert.strictEqual(sddRulingRatifyAction(ruling('')), null);
  assert.strictEqual(sddRulingRatifyAction(null), null);
  assert.strictEqual(sddRulingRatifyAction(undefined), null);
});

test('a Defer-reason below the first blank line never counts — the header alone decides', () => {
  assert.strictEqual(sddRulingRatifyAction('Ruling: x\nDefers: no\n\nDefer-reason: genuinely-larger\n'), 'accept');
});

test('SDD_RULING_RATIFY_ACTIONS is frozen with exactly file-record and accept', () => {
  assert.ok(Object.isFrozen(SDD_RULING_RATIFY_ACTIONS));
  assert.deepStrictEqual(Object.values(SDD_RULING_RATIFY_ACTIONS).sort(), ['accept', 'file-record']);
});
