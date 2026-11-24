'use strict';
// plan.js (#6147) — starting lists, planOf, planEvent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { STARTING_LISTS, planOf, planEvent, replanEvent } = require('../../../plugin/bin/lib/station-events/plan');
const { STATION, STATIONS, KIND, REASON } = require('../../../plugin/bin/lib/station-events/stations');
const { buildLine } = require('../../../plugin/bin/lib/station-events/emit');

const NULLS = { list: 'standard', stations: [...STATIONS], reasonCode: REASON.DEFAULT_LIST };
const ARGS = { repoName: 'acme/w', recordNumber: 6147, lane: 'unknown', ceremonyProfile: null, sessionId: 's1', runId: 'r1' };

test('AC1.1: standard profile gives every station', () => {
  const p = planOf({ lane: 'unknown', ceremonyProfile: 'standard' });
  assert.equal(p.list, 'standard');
  assert.deepEqual(p.stations, [...STATIONS]);
  assert.deepEqual(STARTING_LISTS.standard, [...STATIONS]);
});
test('AC1.2, AC3.1: null lane and null profile gives list standard with reason default-list', () => {
  assert.deepEqual(planOf({ lane: null, ceremonyProfile: null }), NULLS);
});
test("AC1.3: each profile in Task 1's table gives its listed stations", () => {
  const selectors = { standard: { lane: null, ceremonyProfile: 'standard' }, 'fast-lane': { lane: null, ceremonyProfile: 'fast-lane' }, driver: { lane: 'driver', ceremonyProfile: null } };
  assert.deepEqual(Object.keys(STARTING_LISTS).sort(), Object.keys(selectors).sort());
  for (const [id, input] of Object.entries(selectors)) {
    const p = planOf(input);
    assert.equal(p.list, id);
    assert.deepEqual(p.stations, [...STARTING_LISTS[id]]);
  }
  assert.deepEqual(STARTING_LISTS['fast-lane'], STATIONS.filter((s) => s !== STATION.POLISH));
  assert.deepEqual(STARTING_LISTS.driver, STATIONS.filter((s) => s !== STATION.POLISH));
});
test('AC1.4: planEvent is idempotent for the same record and run', () => {
  const a = buildLine(planEvent(ARGS)); const b = buildLine(planEvent({ ...ARGS, sessionId: 's2' }));
  assert.ok(a && b);
  assert.equal(a.eventKey, b.eventKey);
  assert.notEqual(buildLine(planEvent({ ...ARGS, runId: 'r2' })).eventKey, a.eventKey);
  assert.notEqual(buildLine(planEvent({ ...ARGS, recordNumber: 6148 })).eventKey, a.eventKey);
});
test('lane driver with profile fast-lane gives list driver', () => {
  assert.equal(planOf({ lane: 'driver', ceremonyProfile: 'fast-lane' }).list, 'driver');
});
test('lane driver with a null profile gives driver', () => {
  assert.equal(planOf({ lane: 'driver', ceremonyProfile: null }).list, 'driver');
});
test('lane standard with profile fast-lane gives fast-lane', () => {
  assert.equal(planOf({ lane: 'standard', ceremonyProfile: 'fast-lane' }).list, 'fast-lane');
});
test('lane express with profile fast-lane gives fast-lane', () => {
  assert.equal(planOf({ lane: 'express', ceremonyProfile: 'fast-lane' }).list, 'fast-lane');
});
test('lane unknown with a null profile gives standard with reasonCode default-list', () => {
  const p = planOf({ lane: 'unknown', ceremonyProfile: null });
  assert.equal(p.list, 'standard');
  assert.equal(p.reasonCode, REASON.DEFAULT_LIST);
});
test('lane standard with a null profile gives standard with reason other and reasonText lane standard', () => {
  const p = planOf({ lane: 'standard', ceremonyProfile: null });
  assert.equal(p.list, 'standard');
  assert.equal(p.reasonCode, REASON.OTHER);
  assert.equal(p.reasonText, 'lane standard');
});
test('lane express with a null profile gives standard with reason other and reasonText lane express', () => {
  const p = planOf({ lane: 'express', ceremonyProfile: null });
  assert.equal(p.list, 'standard');
  assert.equal(p.reasonCode, REASON.OTHER);
  assert.equal(p.reasonText, 'lane express');
});
test('a lane outside LANES with a null profile gives standard with reasonCode default-list', () => {
  const p = planOf({ lane: 'bogus', ceremonyProfile: null });
  assert.equal(p.list, 'standard');
  assert.equal(p.reasonCode, REASON.DEFAULT_LIST);
  assert.equal('reasonText' in p, false);
});
test('an unknown ceremony profile is treated as absent', () => {
  assert.deepEqual(planOf({ lane: 'unknown', ceremonyProfile: 'bogus' }), NULLS);
});
test('planOf never throws on a non-object argument', () => {
  for (const arg of [undefined, null, 'x', 5]) {
    const p = planOf(arg);
    assert.equal(p.list, 'standard');
    assert.equal(p.reasonCode, REASON.DEFAULT_LIST);
  }
});
test('planEvent builds a line appendStationEvent accepts', () => {
  const ev = planEvent(ARGS);
  assert.ok(buildLine(ev));
  assert.equal(ev.kind, KIND.PLANNED);
  assert.equal(ev.kind, 'planned');
  assert.equal(ev.station, STATION.BUILD);
  assert.equal(ev.outcome, null);
  assert.deepEqual(ev.payload, { process: 'build-a-record', processVersion: 1, list: 'standard', stations: [...STATIONS], reasonCode: 'default-list' });
});
test('planEvent never throws on a non-object argument', () => {
  for (const arg of [null, undefined, 'x']) {
    const ev = planEvent(arg);
    assert.equal(typeof ev, 'object');
    assert.equal(ev.kind, KIND.PLANNED);
    assert.deepEqual(ev.payload, { process: 'build-a-record', processVersion: 1, list: 'standard', stations: [...STATIONS], reasonCode: REASON.DEFAULT_LIST });
  }
});
test('a known selector carries reason other with its reasonText', () => {
  const d = planOf({ lane: 'driver', ceremonyProfile: null });
  assert.equal(d.reasonCode, REASON.OTHER);
  assert.equal(d.reasonText, 'lane driver');
  assert.equal(planOf({ lane: null, ceremonyProfile: 'fast-lane' }).reasonText, 'ceremony profile fast-lane');
  const s = planOf({ lane: null, ceremonyProfile: 'standard' });
  assert.equal(s.reasonCode, REASON.OTHER);
  assert.equal(s.reasonText, 'ceremony profile standard');
});
test('planEvent carries reasonText in the payload only when planOf returned one', () => {
  assert.equal('reasonText' in planEvent(ARGS).payload, false);
  assert.equal(planEvent({ ...ARGS, ceremonyProfile: 'fast-lane' }).payload.reasonText, 'ceremony profile fast-lane');
});
test('planEvent chooses the list by listLane and keeps lane on the line', () => {
  const ev = planEvent({ ...ARGS, lane: 'unknown', listLane: 'driver' });
  assert.equal(ev.lane, 'unknown');
  assert.equal(ev.payload.list, 'driver');
});
const REPLAN = { repoName: 'acme/w', recordNumber: 6148, sessionId: 's1', runId: 'r1', at: '2026-11-24T10:00:00Z', cause: { kind: 'config' } };
test('replanEvent returns null when the stations are unchanged', () => {
  assert.equal(replanEvent({ ...REPLAN, before: [...STATIONS], after: [...STATIONS], reasonCode: REASON.OTHER }), null);
});
test('replanEvent for Test and Polish removed carries the after list and reason documents-only', () => {
  const after = STATIONS.filter((s) => s !== STATION.TEST && s !== STATION.POLISH);
  const ev = replanEvent({ ...REPLAN, before: [...STATIONS], after, reasonCode: REASON.DOCUMENTS_ONLY });
  assert.equal(ev.kind, KIND.REPLANNED);
  assert.deepEqual(ev.payload, { stations: after, reasonCode: 'documents-only', cause: { kind: 'config' } });
  assert.ok(buildLine(ev));
  assert.equal(ev.at, REPLAN.at);
});
test('mutating a returned stations array leaves STARTING_LISTS unchanged', () => {
  const p = planOf({ lane: null, ceremonyProfile: null });
  p.stations.push('x');
  p.stations.length = 0;
  assert.deepEqual(STARTING_LISTS.standard, [...STATIONS]);
  assert.ok(Object.isFrozen(STARTING_LISTS) && Object.isFrozen(STARTING_LISTS.standard));
});
