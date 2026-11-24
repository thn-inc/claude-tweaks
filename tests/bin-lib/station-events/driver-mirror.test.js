'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stationEventsFor, DRIVER_STEP_ACTORS } = require('../../../plugin/bin/lib/station-events/driver-mirror');
const { DRIVER_STEP_STATIONS, ACTORS } = require('../../../plugin/bin/lib/station-events/stations');
const { buildLine } = require('../../../plugin/bin/lib/station-events/emit');

const TS = '2026-11-19T08:00:10.000Z';
const ID = { repoName: 'acme/widgets', runId: 'run-1' };
const line = (over = {}) => ({ ts: TS, run: 'run-1', record: 7, step: 'worker', status: 'ok', ms: 4000, ...over });
const exitedOf = (over) => stationEventsFor(line(over), ID).find((e) => e.kind === 'exited');
const kinds = (events) => events.map((e) => [e.kind, e.station, e.outcome]);

test('a worker line gives started at ts minus ms and exited at ts, both on build', () => {
  const events = stationEventsFor(line(), ID);
  assert.deepEqual(events, [
    { repoName: 'acme/widgets', recordNumber: 7, lane: 'driver', runId: 'run-1', discriminator: `worker@${TS}`,
      kind: 'started', station: 'build', at: '2026-11-19T08:00:06.000Z', payload: { step: 'worker' } },
    { repoName: 'acme/widgets', recordNumber: 7, lane: 'driver', runId: 'run-1', discriminator: `worker@${TS}`,
      kind: 'exited', station: 'build', at: TS, outcome: 'passed', payload: { step: 'worker', actor: 'agent' } },
  ]);
  for (const e of events) assert.ok(buildLine(e), `${e.kind} builds a line`);
});

test('a step status maps to its outcome: fail -> failed, stop -> stopped', () => {
  assert.equal(stationEventsFor(line({ step: 'test', status: 'fail' }), ID)[1].outcome, 'failed');
  assert.equal(stationEventsFor(line({ step: 'ci', status: 'stop' }), ID)[1].outcome, 'stopped');
  assert.equal(stationEventsFor(line({ status: 'bogus' }), ID).some((e) => e.kind === 'exited'), false);
});

const shape = (e) => [e.outcome, e.payload.reasonCode, e.payload.actor];

test('AC1.1: a red-tests stop at the test step mirrors to exited failed with reasonCode test-failed and actor agent', () => {
  for (const detail of ['red tests', 'red tests; no relaunch: no step-up']) {
    const e = exitedOf({ step: 'test', status: 'stop', detail, verifyExit: 1 });
    assert.deepEqual(shape(e), ['failed', 'test-failed', 'agent'], detail);
    assert.equal(Object.hasOwn(e.payload, 'reasonText'), false);
    assert.ok(buildLine(e), 'the emitter accepts it');
  }
});

test('AC1.1: a verdictless fail at the test step mirrors to exited failed with reasonCode infrastructure', () => {
  for (const verifyExit of [1, 2, 137, null]) {
    const e = exitedOf({ step: 'test', status: 'fail', detail: 'verify exited 2', verifyExit });
    assert.deepEqual(shape(e), ['failed', 'infrastructure', 'agent'], String(verifyExit));
    assert.ok(buildLine(e));
  }
});

test('AC1.1: a failed ci step classified infrastructure mirrors with reasonCode infrastructure', () => {
  for (const detail of ['read-failed', 'gh-absent', 'no-pr']) {
    const e = exitedOf({ step: 'ci', status: 'fail', detail });
    assert.deepEqual(shape(e), ['failed', 'infrastructure', 'script'], detail);
    assert.ok(buildLine(e));
  }
  const s = exitedOf({ step: 'ci', status: 'stop', detail: 'gh-absent' });
  assert.deepEqual([s.outcome, s.payload.reasonCode, s.payload.reasonText], ['stopped', 'infrastructure', 'gh-absent']);
  assert.ok(buildLine(s));
});

test('an interrupted fail at the test step mirrors to exited failed with reasonCode unspecified', () => {
  const e = exitedOf({ step: 'test', status: 'fail', detail: 'interrupted by SIGTERM' });
  assert.deepEqual(shape(e), ['failed', 'unspecified', 'agent']);
  assert.ok(buildLine(e));
});

test('AC1.4 AC2.1: a step with no known reason mirrors with reasonCode unspecified', () => {
  const cases = [
    { step: 'test', status: 'fail', detail: 'the worktree differs from HEAD after the test step on 1 path(s): a.js' },
    { step: 'ci', status: 'fail', detail: 'interrupted by SIGTERM' },
    { step: 'worker', status: 'fail' },
  ];
  for (const c of cases) {
    const e = exitedOf(c);
    assert.equal(e.payload.reasonCode, 'unspecified', JSON.stringify(c));
    assert.equal(e.outcome, 'failed');
    assert.ok(buildLine(e));
  }
});

test('AC2.1: a stop at any other step mirrors to exited stopped with reasonCode unspecified and the driver reason in reasonText', () => {
  const pr = exitedOf({ step: 'pr', status: 'stop', detail: 'no changed files' });
  assert.deepEqual([pr.outcome, pr.payload.reasonCode, pr.payload.actor, pr.payload.reasonText], ['stopped', 'unspecified', 'script', 'no changed files']);
  assert.ok(buildLine(pr));
  const detail = '.claude-tweaks/verify-scope.json is not a regular file (dir); verify.js was not run';
  const t = exitedOf({ step: 'test', status: 'stop', detail });
  assert.deepEqual([t.outcome, t.payload.reasonCode, t.payload.actor, t.payload.reasonText], ['stopped', 'unspecified', 'agent', detail]);
  const bare = exitedOf({ step: 'pr', status: 'stop' });
  assert.ok(buildLine(bare));
  assert.equal(Object.hasOwn(bare.payload, 'reasonText'), false);
  // The structured field, not the text, is the key.
  assert.equal(exitedOf({ step: 'test', status: 'stop', detail: 'red tests' }).outcome, 'stopped');
});

test('every driver step station has an actor', () => {
  assert.deepEqual(Object.keys(DRIVER_STEP_ACTORS).sort(), Object.keys(DRIVER_STEP_STATIONS).sort());
  for (const a of Object.values(DRIVER_STEP_ACTORS)) assert.match(a, ACTORS);
});

test('an ok step mirrors to exited passed with actor and no reason', () => {
  for (const [step, actor] of [['worker', 'agent'], ['test', 'agent'], ['review', 'agent'], ['pr', 'script'], ['ci', 'script'], ['merge', 'script']]) {
    const e = exitedOf({ step });
    assert.equal(e.outcome, 'passed');
    assert.equal(e.payload.actor, actor);
    assert.ok(buildLine(e));
    assert.equal(Object.hasOwn(e.payload, 'reasonCode'), false);
    assert.equal(Object.hasOwn(e.payload, 'reasonText'), false);
  }
  assert.equal(Object.hasOwn(exitedOf({ step: 'ci', detail: 'read-failed' }).payload, 'reasonCode'), false);
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

test('#5997: a relaunch worker line (attempt 2, no fix marker) maps to a work segment and binds its own session', () => {
  const relaunch = line({ attempt: 2, trigger: 'red-tests', escalatedFrom: 'fast', sessionId: 's2' });
  const events = stationEventsFor(relaunch, ID);
  assert.deepEqual(kinds(events), [['started', 'build', undefined], ['exited', 'build', 'passed'], ['session_bound', 'build', undefined]]);
  assert.equal(events.find((e) => e.kind === 'session_bound').sessionId, 's2');
  // Control: the same line marked as a fix-round launch maps to nothing.
  assert.deepEqual(stationEventsFor({ ...relaunch, fix: true }, ID), []);
});

test('merge sub-steps: ready enters, a merged confirm exits passed, a park exits sent-back', () => {
  assert.deepEqual(kinds(stationEventsFor(line({ step: 'merge-ready', detail: 'PR undrafted' }), ID)), [['entered', 'merge', undefined]]);
  const confirm = stationEventsFor(line({ step: 'merge-confirm', detail: 'merged, unit concluded SUCCESS' }), ID);
  assert.deepEqual(kinds(confirm), [['exited', 'merge', 'passed']]);
  assert.deepEqual(confirm[0].payload, { substep: 'merge-confirm', actor: 'script' });
  assert.equal(confirm[0].at, TS);
  assert.deepEqual(kinds(stationEventsFor(line({ step: 'merge-park', status: 'stop', detail: 'ci-red: x' }), ID)), [['exited', 'merge', 'sent-back']]);
});

test('a merge-park is written as sent-back next build', () => {
  const [e] = stationEventsFor(line({ step: 'merge-park', status: 'stop', detail: 'ci-red: x' }), ID);
  assert.equal(e.outcome, 'sent-back');
  assert.equal(e.payload.next, 'build');
});

test('a merge-park stop mirrors to exited merge sent-back with next build, actor script and the detail as reasonText', () => {
  const [e] = stationEventsFor(line({ step: 'merge-park', status: 'stop', detail: 'ci-red: x' }), ID);
  assert.deepEqual(e.payload, { substep: 'merge-park', actor: 'script', reasonCode: 'unspecified', next: 'build', reasonText: 'ci-red: x' });
});

test('a merge-park with no detail has no reasonText', () => {
  const [e] = stationEventsFor(line({ step: 'merge-park', status: 'stop' }), ID);
  assert.equal(Object.hasOwn(e.payload, 'reasonText'), false);
});

test('a merge-confirm that merged carries actor script', () => {
  const [e] = stationEventsFor(line({ step: 'merge-confirm', detail: 'merged, unit concluded SUCCESS' }), ID);
  assert.equal(e.payload.actor, 'script');
});

test('every mirrored merge exit passes buildLine', () => {
  let checked = 0;
  for (const over of [{ step: 'merge-confirm', detail: 'merged' }, { step: 'merge-park', status: 'stop', detail: 'ci-red: x' }, { step: 'merge-park', status: 'stop' }]) {
    for (const e of stationEventsFor(line(over), ID).filter((x) => x.kind === 'exited')) { assert.ok(buildLine(e), JSON.stringify(over)); checked += 1; }
  }
  assert.ok(checked >= 3, 'each of the three inputs produced an exit, so an empty filter cannot pass');
});

test('a settle-label ok line writes held why blocked at the stopped step\'s station', () => {
  const events = stationEventsFor(line({ step: 'settle-label', status: 'ok', stopStep: 'test' }), ID);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { repoName: 'acme/widgets', recordNumber: 7, lane: 'driver', runId: 'run-1', sessionId: null, discriminator: `settle-label@${TS}`,
    kind: 'held', station: 'test', at: TS, payload: { why: 'blocked' } });
  assert.ok(buildLine(events[0]));
});

test('a settle-label stop at a step with no station is held at build', () => {
  for (const over of [{ stopStep: 'check' }, {}]) {
    const [e] = stationEventsFor(line({ step: 'settle-label', status: 'ok', ...over }), ID);
    assert.deepEqual([e.station, e.payload], ['build', { why: 'blocked' }]);
  }
});

test('a settle-label after a claim stop is held at release', () => {
  const [e] = stationEventsFor(line({ step: 'settle-label', status: 'ok', stopStep: 'claim' }), ID);
  assert.equal(e.station, 'release');
});

test('a failed settle-label writes no hold', () => {
  assert.deepEqual(stationEventsFor(line({ step: 'settle-label', status: 'fail', stopStep: 'test' }), ID), []);
});

test('an applied park writes held why parked at merge beside the sent-back exit', () => {
  const events = stationEventsFor(line({ step: 'merge-park', status: 'stop', parked: true, detail: 'ci-red: bot:parked applied to record 7' }), ID);
  assert.deepEqual(kinds(events), [['exited', 'merge', 'sent-back'], ['held', 'merge', undefined]]);
  assert.deepEqual(events[1].payload, { why: 'parked' });
  assert.equal(events[1].at, TS);
  assert.equal(events[1].discriminator, `merge-park@${TS}`);
  assert.deepEqual(kinds(stationEventsFor(line({ step: 'merge-park', status: 'stop', parked: false, detail: 'ci-red: x' }), ID)), [['exited', 'merge', 'sent-back']]);
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
