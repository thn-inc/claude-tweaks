'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  LABEL_TRANSITIONS, MERGE_SUBSTEP_TRANSITIONS,
  outcomeForReleaseReason, outcomeForDriverStatus, transitionsForLabel,
} = require('../../../plugin/bin/lib/station-events/stations');

test('outcomeForReleaseReason maps each reason family', () => {
  assert.equal(outcomeForReleaseReason('merged'), 'passed');
  assert.equal(outcomeForReleaseReason('pr-opened'), 'passed');
  assert.equal(outcomeForReleaseReason('pr-opened:draft'), 'passed');
  assert.equal(outcomeForReleaseReason('never-started'), 'abandoned');
  assert.equal(outcomeForReleaseReason('swept:stale'), 'abandoned');
  assert.equal(outcomeForReleaseReason('failed'), 'failed');
  assert.equal(outcomeForReleaseReason('fail-test'), 'failed');
  assert.equal(outcomeForReleaseReason('parked'), 'returned');
  assert.equal(outcomeForReleaseReason(undefined), 'returned');
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
