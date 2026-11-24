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

const { blockersChanged, makeHoldSink, holdEvent, HOLD_LABEL_WHY } = require('../../../plugin/bin/lib/station-events/blockers');
const { HOLD_WHYS } = require('../../../plugin/bin/lib/station-events/stations');

const ENTRY = { blockedBy: [5], openBlocker: true, openBlockerIds: [5] };
const SNAP = { blockedBy: [5], openBlockerIds: [5], crossRepoBlockers: [], fetchedAt: 'a' };

test('an unchanged snapshot is not appended', () => {
  const { events, stationEvent } = capture();
  makeBlockerSnapshotSink({ stationEvent, lastPayload: () => SNAP })(11, ENTRY, META);
  assert.deepEqual(events, []);
  assert.equal(blockersChanged(SNAP, { ...SNAP, fetchedAt: 'b' }), false);
});

test('a changed blocker set is appended', () => {
  const { events, stationEvent } = capture();
  makeBlockerSnapshotSink({ stationEvent, lastPayload: () => ({ ...SNAP, openBlockerIds: [] }) })(11, ENTRY, META);
  assert.equal(events.length, 1);
});

test('the first snapshot for a record is appended', () => {
  const { events, stationEvent } = capture();
  makeBlockerSnapshotSink({ stationEvent, lastPayload: () => null })(11, ENTRY, META);
  assert.equal(events.length, 1);
  assert.equal(blockersChanged(null, SNAP), true);
});

test('adding bot:blocked writes held why blocked with the blocker ref', () => {
  const { events, stationEvent } = capture();
  makeHoldSink({ stationEvent })({ label: 'bot:blocked', added: true, recordNumber: 11, repoName: 'acme/w', station: 'build', ref: '#5', discriminator: 'd-1' });
  assert.equal(events[0].discriminator, 'd-1');
  assert.equal(events[0].kind, 'held');
  assert.deepEqual(events[0].payload, { why: 'blocked', ref: '#5' });
  assert.notEqual(buildLine(events[0]), null);
});

test('removing it writes released why blocked', () => {
  const { events, stationEvent } = capture();
  makeHoldSink({ stationEvent })({ label: 'bot:blocked', added: false, recordNumber: 11, repoName: 'acme/w', station: 'build', ref: '#5', discriminator: 'd-1' });
  assert.equal(events[0].discriminator, 'd-1');
  assert.equal(events[0].kind, 'released');
  assert.deepEqual(events[0].payload, { why: 'blocked' });
  assert.notEqual(buildLine(events[0]), null);
});

test('a non-hold label writes nothing', () => {
  const { events, stationEvent } = capture();
  makeHoldSink({ stationEvent })({ label: 'ready', added: true, recordNumber: 11, repoName: 'acme/w', station: 'build', discriminator: 'd-1' });
  assert.deepEqual(events, []);
  assert.equal(holdEvent({ label: 'ready', added: true }), null);
});

test('every hold label maps into HOLD_WHYS', () => {
  for (const why of Object.values(HOLD_LABEL_WHY)) assert.ok(HOLD_WHYS.includes(why), why);
  assert.deepEqual(Object.keys(HOLD_LABEL_WHY).sort(), ['accept:changes-requested', 'bot:blocked', 'bot:parked']);
});

test('bot:parked added writes held why parked with no ref', () => {
  const { events, stationEvent } = capture();
  makeHoldSink({ stationEvent })({ label: 'bot:parked', added: true, recordNumber: 11, repoName: 'acme/w', station: 'build', discriminator: 'd-2' });
  assert.deepEqual(events[0].payload, { why: 'parked' });
});

test('a prototype-chain name is not a hold label', () => {
  for (const label of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(holdEvent({ label, added: true, recordNumber: 11, repoName: 'acme/w', station: 'build', discriminator: 'd-1' }), null);
  }
});

test('holdEvent pins its defaults and drops a ref on released or a non-string ref', () => {
  const base = { label: 'bot:blocked', recordNumber: 11, repoName: 'acme/w', station: 'build', discriminator: 'd-1' };
  const held = holdEvent({ ...base, added: true, ref: '#5' });
  assert.equal(held.lane, 'unknown');
  assert.equal(held.runId, null);
  assert.equal(held.sessionId, null);
  assert.equal(held.at, null);
  assert.deepEqual(holdEvent({ ...base, added: false, ref: '#5' }).payload, { why: 'blocked' });
  assert.deepEqual(holdEvent({ ...base, added: true, ref: 5 }).payload, { why: 'blocked' });
  assert.deepEqual(holdEvent({ ...base, added: true }).payload, { why: 'blocked' });
});
