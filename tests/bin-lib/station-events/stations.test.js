'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  LABEL_TRANSITIONS, MERGE_SUBSTEP_TRANSITIONS,
  outcomeForReleaseReason, outcomeForDriverStatus, transitionsForLabel,
} = require('../../../plugin/bin/lib/station-events/stations');
const { PARK_REASON } = require('../../../plugin/bin/lib/accept/park-grammar');
const { ABORT_REASON } = require('../../../plugin/bin/lib/claim-targets/claim-targets');

// The strings below are the real release vocabulary: _shared/issue-claims.md's Release triggers
// table, park-grammar.js's PARK_REASON, claim-targets.js's ABORT_REASON and settle.js's
// `drive.js settle: {outcome} at {step}` (outcome words from driver/events.js's OUTCOME_BY_CLASS).
test('outcomeForReleaseReason maps each real reason family', () => {
  for (const r of ['merged: spec 5902', 'merged', 'merged PR #1627', 'pr-opened: spec 5902', 'pr-opened', 'pr-opened:draft',
    PARK_REASON, 'drive.js settle: pending-review at summary']) {
    assert.equal(outcomeForReleaseReason(r), 'passed', r);
  }
  for (const r of ['abandoned: spec 9', 'abandoned', ABORT_REASON, 'never-started', 'swept: stale claim', 'swept: issue closed', 'swept:stale',
    'drive.js settle: refused at admission']) {
    assert.equal(outcomeForReleaseReason(r), 'abandoned', r);
  }
  for (const r of ['failed: local-ahead-of-origin', 'failed: test', 'failed', 'drive.js settle: blocked at test', 'drive.js settle: blocked at claim']) {
    assert.equal(outcomeForReleaseReason(r), 'failed', r);
  }
  assert.equal(outcomeForReleaseReason('drive.js settle: express-escalated at check'), 'returned');
  for (const r of ['parked', 'fail-test', 'mergedX', 'merge', undefined, null, '']) {
    assert.equal(outcomeForReleaseReason(r), 'returned', String(r));
  }
});

test('outcomeForReleaseReason covers every outcome word settle.js can write', () => {
  const { STOP_CLASSES, outcomeFor } = require('../../../plugin/bin/lib/driver/events');
  const seen = new Set();
  for (const cls of Object.values(STOP_CLASSES)) {
    const word = outcomeFor(cls);
    seen.add(outcomeForReleaseReason(`drive.js settle: ${word} at test`));
  }
  // Four words, four classes: passed (finished, pending review), abandoned (refused), failed (blocked), returned (escalated).
  assert.deepEqual([...seen].sort(), ['abandoned', 'failed', 'passed', 'returned']);
});

test('outcomeForDriverStatus maps ok, fail and stop', () => {
  assert.equal(outcomeForDriverStatus('ok'), 'passed');
  assert.equal(outcomeForDriverStatus('fail'), 'failed');
  assert.equal(outcomeForDriverStatus('stop'), 'returned');
  assert.equal(outcomeForDriverStatus('weird'), null);
});

test('transitionsForLabel returns each registry row', () => {
  assert.deepEqual(transitionsForLabel('needs:definition', 'removed'), [
    { kind: 'exited', station: 'intake', outcome: 'passed' },
  ]);
  assert.deepEqual(transitionsForLabel('needs:definition', 'added'), []);
  assert.deepEqual(transitionsForLabel('ready', 'added'), [
    { kind: 'exited', station: 'intake', outcome: 'passed' },
    { kind: 'exited', station: 'shape', outcome: 'passed' },
    { kind: 'entered', station: 'authorize' },
  ]);
  assert.deepEqual(transitionsForLabel('auto:build', 'added'), [
    { kind: 'exited', station: 'authorize', outcome: 'passed' },
    { kind: 'entered', station: 'release' },
  ]);
  assert.deepEqual(transitionsForLabel('bot:in-progress', 'added'), [
    { kind: 'exited', station: 'release', outcome: 'passed' },
    { kind: 'entered', station: 'build' },
  ]);
  assert.deepEqual(transitionsForLabel('accept:pending', 'added'), [{ kind: 'entered', station: 'accept' }]);
  assert.deepEqual(Object.keys(LABEL_TRANSITIONS).sort(), ['accept:pending', 'auto:build', 'bot:in-progress', 'needs:definition', 'ready']);
  assert.deepEqual(transitionsForLabel('bot:blocked', 'added'), []);
  assert.deepEqual(transitionsForLabel('nope', 'added'), []);
});

test('transitionsForLabel returns fresh copies', () => {
  const first = transitionsForLabel('ready', 'added');
  first[0].station = 'mutated';
  first.push({ kind: 'entered', station: 'x' });
  assert.equal(transitionsForLabel('ready', 'added').length, 3);
  assert.equal(transitionsForLabel('ready', 'added')[0].station, 'intake');
});

test('MERGE_SUBSTEP_TRANSITIONS omits merge-call and only merge-confirm skips armed', () => {
  assert.deepEqual(Object.keys(MERGE_SUBSTEP_TRANSITIONS).sort(), ['merge-confirm', 'merge-park', 'merge-ready']);
  assert.equal(Object.prototype.hasOwnProperty.call(MERGE_SUBSTEP_TRANSITIONS, 'merge-call'), false);
  for (const [name, t] of Object.entries(MERGE_SUBSTEP_TRANSITIONS)) {
    assert.equal(t.substep, name);
    assert.equal(t.skipDetailPrefix, name === 'merge-confirm' ? 'armed' : undefined);
  }
});
