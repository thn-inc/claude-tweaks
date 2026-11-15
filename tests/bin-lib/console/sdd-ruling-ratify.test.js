'use strict';
// #3942: sddRulingRatifyAction — what ratifying an sdd-ruling-* item does.
// A deferral files a backlog record (file-record); a settled Defers: no
// ruling keeps the accepted write-back (accept). A deferral the gate withholds
// is not auto-ratifiable (sddRulingDeferralReason non-null) but is still
// ratifiable by a human; only unreadable text is not ratifiable (null).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { SDD_RULING_RATIFY_ACTIONS, sddRulingRatifyAction, sddRulingDeferralReason } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'console', 'sdd-ruling'));

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

test('AC5.1 AC5.2: every gate-withheld deferral header ratifies as file-record while the gate still holds it', () => {
  for (const header of [
    'Defers: yes\n',
    'Defers: yes\nDefer-reason: tangential\nDefer-reason: genuinely-larger\n',
    'Defers: yes\nDefer-reason: minor\n',
    '',
    'Defers: yes\nDefer-reason: needs-human-decision\n',
  ]) {
    const t = ruling(header);
    assert.strictEqual(sddRulingRatifyAction(t), 'file-record', JSON.stringify(header));
    assert.notStrictEqual(sddRulingDeferralReason(t), null, JSON.stringify(header));
  }
});

test('AC6.1: several agreeing Defers: no lines with no Defer-reason ratify as accept, while the gate still holds them', () => {
  for (const header of ['Defers: no\nDefers: no\n', 'Defers: no\ndefers: NO\n']) {
    const t = ruling(header);
    assert.strictEqual(sddRulingRatifyAction(t), 'accept', JSON.stringify(header));
    assert.strictEqual(sddRulingDeferralReason(t), 'sdd-ruling-unclassified', JSON.stringify(header));
  }
});

test('AC6.2: conflicting Defers: lines, an unknown Defers: value and a missing Defers: line ratify as file-record, never accept', () => {
  for (const header of ['Defers: yes\nDefers: no\n', 'Defers: no\nDefers: yes\n', 'Defers: maybe\n', 'Defers: no\nDefers: maybe\n', '']) {
    assert.strictEqual(sddRulingRatifyAction(ruling(header)), 'file-record', JSON.stringify(header));
  }
});

test('AC6.2: a Defers: line with an empty or multi-word value counts — file-record, and the gate holds it', () => {
  for (const header of ['Defers: no\nDefers: not sure\n', 'Defers: no\nDefers:\n']) {
    const t = ruling(header);
    assert.strictEqual(sddRulingRatifyAction(t), 'file-record', JSON.stringify(header));
    assert.strictEqual(sddRulingDeferralReason(t), 'sdd-ruling-unclassified', JSON.stringify(header));
  }
});

test('AC6.3: not ratifiable: null, undefined and an empty or blank ruling file return null', () => {
  for (const t of [null, undefined, '', '  \n\t\n']) {
    assert.strictEqual(sddRulingRatifyAction(t), null, JSON.stringify(t));
  }
});

test('a Defer-reason below the first blank line never counts — the header alone decides', () => {
  assert.strictEqual(sddRulingRatifyAction('Ruling: x\nDefers: no\n\nDefer-reason: genuinely-larger\n'), 'accept');
});

test('SDD_RULING_RATIFY_ACTIONS is frozen with exactly file-record and accept', () => {
  assert.ok(Object.isFrozen(SDD_RULING_RATIFY_ACTIONS));
  assert.deepStrictEqual(Object.values(SDD_RULING_RATIFY_ACTIONS).sort(), ['accept', 'file-record']);
});
