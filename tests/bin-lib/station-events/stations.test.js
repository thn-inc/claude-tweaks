'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  STATION, STATIONS, SESSION_BOUND_STATION, PR_OPENED_FACT, PR_OPENED_TRANSITION, LABEL_TRANSITIONS, MERGE_SUBSTEP_TRANSITIONS,
  BLOCKER_SNAPSHOT_STATION, DRIVER_STEP_STATIONS, ACTORS,
  outcomeForReleaseReason, outcomeForDriverStatus, transitionsForLabel, releaseTransition,
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
    assert.equal(outcomeForReleaseReason(r), 'stopped', r);
  }
  for (const r of ['failed: local-ahead-of-origin', 'failed: test', 'failed', 'drive.js settle: blocked at test', 'drive.js settle: blocked at claim']) {
    assert.equal(outcomeForReleaseReason(r), 'failed', r);
  }
  assert.equal(outcomeForReleaseReason('drive.js settle: express-escalated at check'), 'sent-back');
  for (const r of ['parked', 'fail-test', 'mergedX', 'merge', undefined, null, '']) {
    assert.equal(outcomeForReleaseReason(r), 'sent-back', String(r));
  }
});

test('outcomeForReleaseReason covers every outcome word settle.js can write', () => {
  const { STOP_CLASSES, outcomeFor } = require('../../../plugin/bin/lib/driver/events');
  const seen = new Set();
  for (const cls of Object.values(STOP_CLASSES)) {
    const word = outcomeFor(cls);
    seen.add(outcomeForReleaseReason(`drive.js settle: ${word} at test`));
  }
  // Four words, four classes: passed (finished, pending review), stopped (refused), failed (blocked), sent-back (escalated).
  assert.deepEqual([...seen].sort(), ['failed', 'passed', 'sent-back', 'stopped']);
});

test('releaseTransition: a build release is exited build with the mapped outcome; a shaping release is no transition', () => {
  assert.deepEqual(releaseTransition('merged: spec 5902'), { kind: 'exited', station: 'build', outcome: 'passed', payload: { actor: 'script' } });
  assert.deepEqual(releaseTransition(PARK_REASON), { kind: 'exited', station: 'build', outcome: 'passed', payload: { actor: 'script' } });
  assert.deepEqual(releaseTransition(ABORT_REASON), { kind: 'exited', station: 'build', outcome: 'stopped', payload: { actor: 'script', reasonCode: 'unspecified' } });
  assert.deepEqual(releaseTransition('failed: test'), { kind: 'exited', station: 'build', outcome: 'failed', payload: { actor: 'script', reasonCode: 'unspecified' } });
  assert.deepEqual(releaseTransition('shapedX: 1'), { kind: 'exited', station: 'build', outcome: 'sent-back', payload: { actor: 'script', reasonCode: 'unspecified', next: 'release' } });
  assert.notEqual(releaseTransition('merged: spec 5902'), releaseTransition('merged: spec 5902'), 'a fresh object per call');
  assert.notEqual(releaseTransition('merged: spec 5902').payload, releaseTransition('merged: spec 5902').payload, 'a fresh payload per call');
  // specify/next-mode-shape.md's Release step reasons: the claim was a shaping claim, no build visit opened.
  for (const r of ['shaped: #5902', 'routed: needs:definition #5902', 'failed: shaping']) {
    assert.equal(releaseTransition(r), null, r);
  }
  // Only the exact shaping fail is shaping: a build gate failure with a similar word still ends build.
  assert.equal(releaseTransition('failed: shaping-gate-test').outcome, 'failed');
  assert.equal(releaseTransition('shapedX: 1').outcome, 'sent-back');
});

test('STATION names every station once, in journey order, and the call-site helpers point at it', () => {
  assert.deepEqual(STATIONS, ['intake', 'shape', 'authorize', 'release', 'build', 'test', 'review', 'polish', 'wrap-up', 'merge', 'accept']);
  assert.deepEqual(Object.values(STATION), STATIONS);
  assert.equal(STATION.BUILD, 'build');
  assert.equal(STATION.WRAP_UP, 'wrap-up');
  assert.equal(SESSION_BOUND_STATION, STATION.BUILD);
  assert.deepEqual(PR_OPENED_TRANSITION, { kind: 'started', station: STATION.BUILD });
  assert.equal(PR_OPENED_FACT, 'pr_opened');
});

test('every station a table or constant names is a member of STATIONS', () => {
  const named = [BLOCKER_SNAPSHOT_STATION, SESSION_BOUND_STATION, PR_OPENED_TRANSITION.station, ...Object.values(DRIVER_STEP_STATIONS)];
  for (const t of Object.values(MERGE_SUBSTEP_TRANSITIONS)) named.push(t.station);
  for (const entry of Object.values(LABEL_TRANSITIONS)) {
    for (const list of Object.values(entry)) for (const t of list) named.push(t.station);
  }
  for (const r of ['merged: spec 1', 'abandoned', 'failed: test', 'parked', '']) named.push(releaseTransition(r).station);
  // The tables are not empty: a refactor that dropped them would otherwise pass vacuously.
  assert.ok(named.length >= 25, `expected at least 25 named stations, saw ${named.length}`);
  for (const s of named) assert.ok(STATIONS.includes(s), `${s} is not in STATIONS`);
});

test('outcomeForDriverStatus maps ok, fail and stop', () => {
  assert.equal(outcomeForDriverStatus('ok'), 'passed');
  assert.equal(outcomeForDriverStatus('fail'), 'failed');
  assert.equal(outcomeForDriverStatus('stop'), 'stopped');
  assert.equal(outcomeForDriverStatus('weird'), null);
});

test('transitionsForLabel returns each registry row', () => {
  assert.deepEqual(transitionsForLabel('needs:definition', 'removed'), [
    { kind: 'exited', station: 'intake', outcome: 'passed', payload: { actor: 'agent' } },
  ]);
  assert.deepEqual(transitionsForLabel('needs:definition', 'added'), []);
  assert.deepEqual(transitionsForLabel('ready', 'added'), [
    { kind: 'exited', station: 'intake', outcome: 'passed', payload: { actor: 'agent' } },
    { kind: 'exited', station: 'shape', outcome: 'passed', payload: { actor: 'agent' } },
    { kind: 'entered', station: 'authorize' },
  ]);
  assert.deepEqual(transitionsForLabel('auto:build', 'added'), [
    { kind: 'exited', station: 'authorize', outcome: 'passed', payload: { actor: 'person' } },
    { kind: 'entered', station: 'release' },
  ]);
  assert.deepEqual(transitionsForLabel('bot:in-progress', 'added'), [
    { kind: 'exited', station: 'release', outcome: 'passed', payload: { actor: 'script' } },
    { kind: 'entered', station: 'build' },
  ]);
  assert.deepEqual(transitionsForLabel('accept:pending', 'added'), [{ kind: 'entered', station: 'accept' }]);
  assert.deepEqual(Object.keys(LABEL_TRANSITIONS).sort(), ['accept:pending', 'auto:build', 'bot:in-progress', 'needs:definition', 'ready']);
  assert.deepEqual(transitionsForLabel('bot:blocked', 'added'), []);
  assert.deepEqual(transitionsForLabel('nope', 'added'), []);
});

test('every label-transition exit carries an actor', () => {
  const expected = {
    'needs:definition/removed': ['agent'],
    'ready/added': ['agent', 'agent'],
    'auto:build/added': ['person'],
    'bot:in-progress/added': ['script'],
  };
  const exitBearing = [];
  for (const [label, entry] of Object.entries(LABEL_TRANSITIONS)) {
    for (const direction of Object.keys(entry)) {
      if (transitionsForLabel(label, direction).some((r) => r.kind === 'exited')) exitBearing.push(label + '/' + direction);
    }
  }
  assert.deepEqual(Object.keys(expected).sort(), exitBearing.sort());
  for (const [label, entry] of Object.entries(LABEL_TRANSITIONS)) {
    for (const direction of Object.keys(entry)) {
      const rows = transitionsForLabel(label, direction);
      for (const row of rows.filter((r) => r.kind === 'entered')) assert.equal(Object.hasOwn(row, 'payload'), false);
      const actors = rows.filter((r) => r.kind === 'exited').map((r) => r.payload.actor);
      for (const a of actors) assert.match(a, ACTORS);
      if (Object.hasOwn(expected, label + '/' + direction)) assert.deepEqual(actors, expected[label + '/' + direction]);
    }
  }
});

test('transitionsForLabel returns a fresh payload', () => {
  transitionsForLabel('ready', 'added')[0].payload.actor = 'mutated';
  assert.equal(transitionsForLabel('ready', 'added')[0].payload.actor, 'agent');
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

test('every exited line in LABEL_TRANSITIONS and every releaseTransition passes buildLine', () => {
  const { buildLine } = require('../../../plugin/bin/lib/station-events/emit');
  const base = { repoName: 'acme/widgets', recordNumber: 7, lane: 'unknown', runId: 'run-1' };
  let checked = 0;
  for (const label of Object.keys(LABEL_TRANSITIONS)) {
    for (const direction of ['added', 'removed']) {
      for (const t of transitionsForLabel(label, direction).filter((x) => x.kind === 'exited')) {
        assert.ok(buildLine({ ...base, ...t, discriminator: `${label}:${direction}` }), `${label} ${direction} ${t.station}`);
        checked += 1;
      }
    }
  }
  for (const reason of ['merged: spec 1', 'abandoned: spec 1', 'failed: test', 'never-started', 'something else']) {
    const t = releaseTransition(reason);
    assert.ok(buildLine({ ...base, ...t, discriminator: reason }), reason);
    checked += 1;
  }
  assert.ok(checked >= 10, 'the exits were walked, so an empty filter cannot pass');
});
