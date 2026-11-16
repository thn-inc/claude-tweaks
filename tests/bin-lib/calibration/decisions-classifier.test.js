'use strict';

const test = require('node:test');
const assert = require('node:assert');
const classifier = require('../../../plugin/bin/lib/calibration/decisions-classifier.js');
const append = require('../../../plugin/bin/lib/log-decision/append.js');

const { classifyDecisionLine, classifyDecisionLineLenient, entryClock, isStructuralLine, DECISION_STATUSES } = classifier;
const { aggregate } = require('../../../plugin/bin/lib/calibration/aggregate.js');

test('DECISION_STATUSES is the writer set plus FAILED, one array shared by both modules', () => {
  assert.deepStrictEqual(DECISION_STATUSES, ['AUTO', 'STAGED', 'KEPT-PROMPT', 'SCANNED', 'REFUSED', 'SKIP', 'FAILED']);
  assert.strictEqual(classifier.DECISION_STATUSES, append.DECISION_STATUSES);
  assert.ok(!append.STATUSES.includes('FAILED'), 'the writer set stays without FAILED');
});

test('classifyDecisionLine (the calibration default) reads a dashed status line only, as before the step yield', () => {
  for (const status of DECISION_STATUSES) {
    assert.strictEqual(classifyDecisionLine(`- ${status} 08:26:01 — x: y.`).kind, status);
    assert.strictEqual(classifyDecisionLine(`${status} 08:26:01 — x: y.`).kind, 'other', `${status} without the dash`);
  }
  assert.strictEqual(classifyDecisionLine('AUTO 18:47:01 — Backlog refine: s').kind, 'other');
  assert.strictEqual(classifyDecisionLine('random text').kind, 'other');
  assert.strictEqual(classifyDecisionLine('- FUTURE-STATUS 00:00:00 — x').kind, 'other');
  // The base `\b` boundary: a dashed status word followed by a hyphen still reads as that status.
  assert.strictEqual(classifyDecisionLine('- AUTO-merge 10:00:00 — x').kind, 'AUTO');
  assert.strictEqual(classifyDecisionLine('- AUTO\t10:00:00 — x').kind, 'AUTO');
});

test('classifyDecisionLineLenient (opt-in, step yield only): the dash is optional, and a status word glued to prose is not an entry', () => {
  for (const status of DECISION_STATUSES) {
    assert.strictEqual(classifyDecisionLineLenient(`- ${status} 08:26:01 — x: y.`).kind, status);
    assert.strictEqual(classifyDecisionLineLenient(`${status} 08:26:01 — x: y.`).kind, status);
  }
  assert.strictEqual(classifyDecisionLineLenient('AUTO 18:47:01 — Backlog refine: s').kind, 'AUTO');
  assert.strictEqual(classifyDecisionLineLenient('random text').kind, 'other');
  assert.strictEqual(classifyDecisionLineLenient('- FUTURE-STATUS 00:00:00 — x').kind, 'other');
  for (const line of ['AUTO-merge was declined for this record', '- SKIP-ahead notes', 'AUTOMATIC retry', '- AUTO-merge 10:00:00 — x', 'STAGED.']) {
    assert.strictEqual(classifyDecisionLineLenient(line).kind, 'other', line);
  }
  assert.strictEqual(classifyDecisionLineLenient('- AUTO\t10:00:00 — x').kind, 'AUTO');
  const terminal = classifyDecisionLineLenient('AUTO 12:00:00 — Review Console: terminal decision stop. Reversibility: low.');
  assert.deepStrictEqual(terminal, { kind: 'AUTO', terminalDecision: 'stop', reversibility: 'low' });
});

test('aggregate classifies a dash-less status line exactly as before the step yield (not counted)', () => {
  const runs = [{
    runId: '2026-08-18T100000-x',
    decisionLines: ['REFUSED 09:00:00 — Queue write blocked.', 'FAILED 09:01:00 — write failed.', '- REFUSED 09:02:00 — Queue write blocked.'],
  }];
  const out = aggregate({ tsv: { rows: [] }, runs, rowIds: [], windowN: 5 });
  assert.strictEqual(out.refusedCount, 1);
  assert.strictEqual(out.failedCount, 0);
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
