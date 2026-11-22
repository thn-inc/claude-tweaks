'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeBlockerSnapshotSink } = require('../../../plugin/bin/lib/station-events/blockers');
const { buildLine } = require('../../../plugin/bin/lib/station-events/emit');

const META = { owner: 'acme', repo: 'w', host: 'github.com', fetchedAt: '2026-11-19T08:00:00.000Z' };

function capture() {
  const events = [];
  return { events, stationEvent: (e) => events.push(e) };
}

test('the sink maps an entry into a blockers event, carrying crossRepoBlockers through', () => {
  const { events, stationEvent } = capture();
  const cross = [{ number: 5, repository: 'other/repo', state: 'OPEN' }];
  makeBlockerSnapshotSink({ stationEvent, sessionId: 's-1', runId: 'run-1' })(11, {
    blockedBy: [5, 6], openBlocker: true, openBlockerIds: [5], crossRepoBlockers: cross,
  }, META);
  assert.deepEqual(events, [{
    kind: 'blockers', station: 'authorize', recordNumber: 11, repoName: 'acme/w', lane: 'unknown',
    sessionId: 's-1', runId: 'run-1',
    payload: { blockedBy: [5, 6], openBlockerIds: [5], crossRepoBlockers: cross, fetchedAt: META.fetchedAt },
    discriminator: META.fetchedAt,
  }]);
});

test('the sink defaults crossRepoBlockers to [] when the entry has none', () => {
  const { events, stationEvent } = capture();
  makeBlockerSnapshotSink({ stationEvent })(12, { blockedBy: [], openBlocker: false, openBlockerIds: [] }, META);
  assert.deepEqual(events[0].payload.crossRepoBlockers, []);
});

test('the produced event is a valid v1 line with a null outcome', () => {
  const { events, stationEvent } = capture();
  makeBlockerSnapshotSink({ stationEvent, sessionId: 's-1', runId: 'run-1' })(11, {
    blockedBy: [5], openBlocker: true, openBlockerIds: [5],
  }, META);
  const line = buildLine(events[0], { now: () => new Date(META.fetchedAt) });
  assert.notEqual(line, null);
  assert.equal(line.kind, 'blockers');
  assert.equal(line.outcome, null);
  assert.equal(line.repoName, 'acme/w');
});

test('the sink is inert when stationEvent is not a function', () => {
  for (const stationEvent of [undefined, null, 'x', {}]) {
    const sink = makeBlockerSnapshotSink({ stationEvent });
    assert.doesNotThrow(() => sink(11, { blockedBy: [], openBlocker: false, openBlockerIds: [] }, META));
  }
  assert.doesNotThrow(() => makeBlockerSnapshotSink()(11, { blockedBy: [], openBlocker: false, openBlockerIds: [] }, META));
});

test('the sink swallows a throwing stationEvent', () => {
  const sink = makeBlockerSnapshotSink({ stationEvent: () => { throw new Error('emit boom'); } });
  assert.doesNotThrow(() => sink(11, { blockedBy: [], openBlocker: false, openBlockerIds: [] }, META));
});
