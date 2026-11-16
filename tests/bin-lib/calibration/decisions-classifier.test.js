'use strict';

const test = require('node:test');
const assert = require('node:assert');
const classifier = require('../../../plugin/bin/lib/calibration/decisions-classifier.js');
const append = require('../../../plugin/bin/lib/log-decision/append.js');

const { classifyDecisionLine, entryClock, isStructuralLine, DECISION_STATUSES } = classifier;

test('DECISION_STATUSES is the writer set plus FAILED, one array shared by both modules', () => {
  assert.deepStrictEqual(DECISION_STATUSES, ['AUTO', 'STAGED', 'KEPT-PROMPT', 'SCANNED', 'REFUSED', 'SKIP', 'FAILED']);
  assert.strictEqual(classifier.DECISION_STATUSES, append.DECISION_STATUSES);
  assert.ok(!append.STATUSES.includes('FAILED'), 'the writer set stays without FAILED');
});

test('classifyDecisionLine reads every status, with or without the leading dash', () => {
  for (const status of DECISION_STATUSES) {
    assert.strictEqual(classifyDecisionLine(`- ${status} 08:26:01 — x: y.`).kind, status);
    assert.strictEqual(classifyDecisionLine(`${status} 08:26:01 — x: y.`).kind, status);
  }
  assert.strictEqual(classifyDecisionLine('AUTO 18:47:01 — Backlog refine: s').kind, 'AUTO');
  assert.strictEqual(classifyDecisionLine('random text').kind, 'other');
  assert.strictEqual(classifyDecisionLine('- FUTURE-STATUS 00:00:00 — x').kind, 'other');
});

test('a status must be followed by whitespace: prose that merely starts with a status word is not an entry', () => {
  for (const line of ['AUTO-merge was declined for this record', '- SKIP-ahead notes', 'AUTOMATIC retry', '- AUTO-merge 10:00:00 — x', 'STAGED.']) {
    assert.strictEqual(classifyDecisionLine(line).kind, 'other', line);
  }
  assert.strictEqual(classifyDecisionLine('- AUTO\t10:00:00 — x').kind, 'AUTO');
});

test('entryClock reads HH:MM:SS, HH:MM, and ISO times after the status token', () => {
  assert.deepStrictEqual(entryClock('- AUTO 08:26:01 — x: y.'), { h: 8, m: 26, s: 1 });
  assert.deepStrictEqual(entryClock('- AUTO 21:57 — Backlog refine: s'), { h: 21, m: 57, s: 0 });
  assert.deepStrictEqual(entryClock('- AUTO 2026-08-18T14:02:12.963Z — x'), { iso: '2026-08-18T14:02:12.963Z' });
  assert.deepStrictEqual(entryClock('- AUTO 2026-08-18T14:02:12Z — x'), { iso: '2026-08-18T14:02:12Z' });
  assert.deepStrictEqual(entryClock('AUTO 18:47:01 — Backlog refine'), { h: 18, m: 47, s: 1 });
  assert.strictEqual(entryClock('random text'), null);
  assert.strictEqual(entryClock('- AUTO soon — x'), null);
  assert.strictEqual(entryClock(''), null);
});

test('structural: blank, heading, config snapshot, config bullets and continuations are not entries', () => {
  for (const line of [
    '', '## /flow', 'Pipeline config snapshot:', 'Pipeline config snapshot: (auto)', '- mode: auto',
    '- ceremony-profile: standard (header)', 'scope-creep: add-to-plan', '  continuation',
  ]) {
    assert.strictEqual(isStructuralLine(line), true, JSON.stringify(line));
  }
  for (const line of ['- AUTO 08:26:01 — x: y.', 'free prose line', 'AUTO 08:26:01 — x: y.']) {
    assert.strictEqual(isStructuralLine(line), false, JSON.stringify(line));
  }
});
