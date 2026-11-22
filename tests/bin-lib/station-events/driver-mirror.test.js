'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stationEventsFor } = require('../../../plugin/bin/lib/station-events/driver-mirror');
const { buildLine } = require('../../../plugin/bin/lib/station-events/emit');

const TS = '2026-11-19T08:00:10.000Z';
const ID = { repoName: 'acme/widgets', runId: 'run-1' };
const line = (over = {}) => ({ ts: TS, run: 'run-1', record: 7, step: 'worker', status: 'ok', ms: 4000, ...over });
const kinds = (events) => events.map((e) => [e.kind, e.station, e.outcome]);

test('a worker line gives started at ts minus ms and exited at ts, both on build', () => {
  const events = stationEventsFor(line(), ID);
  assert.deepEqual(events, [
    { repoName: 'acme/widgets', recordNumber: 7, lane: 'driver', runId: 'run-1', discriminator: `worker@${TS}`,
      kind: 'started', station: 'build', at: '2026-11-19T08:00:06.000Z', payload: { step: 'worker' } },
    { repoName: 'acme/widgets', recordNumber: 7, lane: 'driver', runId: 'run-1', discriminator: `worker@${TS}`,
      kind: 'exited', station: 'build', at: TS, outcome: 'passed', payload: { step: 'worker' } },
  ]);
  for (const e of events) assert.ok(buildLine(e), `${e.kind} builds a line`);
});

test('a step status maps to its outcome: fail -> failed, stop -> returned', () => {
  assert.equal(stationEventsFor(line({ step: 'test', status: 'fail' }), ID)[1].outcome, 'failed');
  assert.equal(stationEventsFor(line({ step: 'ci', status: 'stop' }), ID)[1].outcome, 'returned');
});

test('every mirrored step lands on its table station', () => {
  const stations = ['worker', 'test', 'review', 'pr', 'ci', 'merge'].map((step) => stationEventsFor(line({ step }), ID)[0].station);
  assert.deepEqual(stations, ['build', 'test', 'review', 'wrap-up', 'merge', 'merge']);
});

test('a worker line carrying sessionId adds one session_bound on build', () => {
  const events = stationEventsFor(line({ sessionId: 'sess-w' }), ID);
  const bound = events.filter((e) => e.kind === 'session_bound');
  assert.equal(bound.length, 1);
  assert.deepEqual([bound[0].station, bound[0].sessionId, bound[0].payload], ['build', 'sess-w', { step: 'worker' }]);
  assert.ok(buildLine(bound[0]));
  assert.equal(stationEventsFor(line({ sessionId: '' }), ID).filter((e) => e.kind === 'session_bound').length, 0);
});

test('a review line carrying fixSessionId adds one session_bound naming the fix worker', () => {
  const events = stationEventsFor(line({ step: 'review', fixSessionId: 'sess-fix' }), ID);
  const bound = events.filter((e) => e.kind === 'session_bound');
  assert.equal(bound.length, 1);
  assert.deepEqual([bound[0].station, bound[0].sessionId, bound[0].payload], ['build', 'sess-fix', { step: 'review', fix: true }]);
  assert.equal(stationEventsFor(line({ step: 'review' }), ID).filter((e) => e.kind === 'session_bound').length, 0);
});

test('#5942: a fix-round worker line maps to no station events', () => {
  assert.deepEqual(stationEventsFor(line({ fix: true, sessionId: 's2' }), ID), []);
  // Control: the same line without `fix` still opens and closes the segment and binds its session.
  assert.deepEqual(kinds(stationEventsFor(line({ sessionId: 's2' }), ID)), [['started', 'build', undefined], ['exited', 'build', 'passed'], ['session_bound', 'build', undefined]]);
  // Only a worker line is dropped: a `fix` flag on another step's line changes nothing.
  assert.equal(stationEventsFor(line({ step: 'review', fix: true }), ID).length, 2);
});

test('merge sub-steps: ready enters, a merged confirm exits passed, a park exits returned', () => {
  assert.deepEqual(kinds(stationEventsFor(line({ step: 'merge-ready', detail: 'PR undrafted' }), ID)), [['entered', 'merge', undefined]]);
  const confirm = stationEventsFor(line({ step: 'merge-confirm', detail: 'merged, unit concluded SUCCESS' }), ID);
  assert.deepEqual(kinds(confirm), [['exited', 'merge', 'passed']]);
  assert.deepEqual(confirm[0].payload, { substep: 'merge-confirm' });
  assert.equal(confirm[0].at, TS);
  assert.deepEqual(kinds(stationEventsFor(line({ step: 'merge-park', status: 'stop', detail: 'ci-red: x' }), ID)), [['exited', 'merge', 'returned']]);
});

test('an armed confirm, a failed ready or confirm, merge-call and the unmapped steps give nothing', () => {
  assert.deepEqual(stationEventsFor(line({ step: 'merge-confirm', detail: 'armed — auto-merge armed' }), ID), []);
  assert.deepEqual(stationEventsFor(line({ step: 'merge-confirm', status: 'stop', detail: 'state-read-failed: x' }), ID), []);
  assert.deepEqual(stationEventsFor(line({ step: 'merge-ready', status: 'stop', detail: 'ready-failed: x' }), ID), []);
  for (const status of ['ok', 'fail', 'stop']) assert.deepEqual(stationEventsFor(line({ step: 'merge-call', status }), ID), [], status);
  for (const step of ['claim', 'policy', 'fetch', 'summary', 'final', 'settle-release', 'merge-gate']) {
    assert.deepEqual(stationEventsFor(line({ step }), ID), [], step);
  }
});

test('a replay of the same line keys identically', () => {
  const keys = (l) => stationEventsFor(l, ID).map((e) => buildLine(e).eventKey);
  const first = keys(line({ sessionId: 'sess-w' }));
  assert.equal(new Set(first).size, 3, 'started, exited and session_bound key apart');
  assert.deepEqual(keys(line({ sessionId: 'sess-w' })), first);
});

test('a missing or non-finite ms puts started at ts', () => {
  assert.equal(stationEventsFor(line({ ms: undefined }), ID)[0].at, TS);
  assert.equal(stationEventsFor(line({ ms: 'x' }), ID)[0].at, TS);
});
