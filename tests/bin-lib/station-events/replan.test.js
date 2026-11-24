'use strict';
// replan.js (#6148) — latestPlans reads the log, replanRun emits `replanned` through a caller sink.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { scratchDir } = require('../../helpers/tmp-dir');
const { latestPlans, replanRun } = require('../../../plugin/bin/lib/station-events/replan');
const { STARTING_LISTS } = require('../../../plugin/bin/lib/station-events/plan');
const { STATION, KIND, REASON } = require('../../../plugin/bin/lib/station-events/stations');

function planLine(kind, runId, recordNumber, stations, lane = 'unknown') {
  return JSON.stringify({ v: 1, repoName: 'acme/w', recordNumber, kind, station: STATION.BUILD, lane, runId, payload: { stations } });
}

function setup(lines) {
  const mainRoot = scratchDir('replan-');
  fs.mkdirSync(path.join(mainRoot, '.claude-tweaks'), { recursive: true });
  if (lines) fs.writeFileSync(path.join(mainRoot, '.claude-tweaks', 'station-events.jsonl'), lines.join('\n') + '\n');
  return { mainRoot, runDir: path.join(mainRoot, '.claude-tweaks', 'pipelines', 'r1') };
}

function run(lines, manifest, ref) {
  const { mainRoot, runDir } = setup(lines);
  const seen = [];
  const n = replanRun({ runDir, manifest, ref, deps: { stationEvent: (e) => seen.push(e), mainRoot, now: () => new Date('2026-11-24T10:00:00Z') } });
  return { n, seen };
}

test('latestPlans returns the last planned or replanned stations per record for the run', () => {
  const { mainRoot } = setup([
    planLine(KIND.PLANNED, 'r1', 7, STARTING_LISTS.standard),
    planLine(KIND.PLANNED, 'r2', 7, STARTING_LISTS.driver),
    planLine(KIND.REPLANNED, 'r1', 7, STARTING_LISTS['fast-lane']),
    'not json',
    '{"v":1,"kind":"pla',
  ]);
  const map = latestPlans({ mainRoot, runId: 'r1' });
  assert.equal(map.size, 1);
  assert.deepEqual(map.get(7).stations, STARTING_LISTS['fast-lane']);
  assert.equal(map.get(7).repoName, 'acme/w');
});

test('replanRun writes nothing when the run has no planned line', () => {
  assert.equal(run([planLine(KIND.PLANNED, 'r2', 7, STARTING_LISTS.standard)], { lane: 'unknown', ceremonyProfile: 'fast-lane' }, 'x').n, 0);
  const none = run(null, { lane: 'unknown', ceremonyProfile: 'fast-lane' }, 'x');
  assert.equal(none.n, 0);
  assert.equal(none.seen.length, 0);
  const dir = scratchDir('replan-nogit-');
  const seen = [];
  assert.equal(replanRun({ runDir: path.join(dir, 'r1'), manifest: { lane: 'unknown', ceremonyProfile: 'fast-lane' }, ref: 'x', deps: { stationEvent: (e) => seen.push(e) } }), 0);
  assert.equal(seen.length, 0);
});

test('fixing the profile to fast-lane after a standard claim writes one replanned without polish', () => {
  const { n, seen } = run([planLine(KIND.PLANNED, 'r1', 7, STARTING_LISTS.standard)], { lane: 'unknown', ceremonyProfile: 'fast-lane' }, 'ceremony-profile');
  assert.equal(n, 1);
  assert.equal(seen.length, 1);
  const e = seen[0];
  assert.equal(e.kind, KIND.REPLANNED);
  assert.equal(e.station, STATION.BUILD);
  assert.deepEqual(e.payload.stations, STARTING_LISTS['fast-lane']);
  assert.equal(e.payload.reasonCode, REASON.CEREMONY_DOWNGRADE);
  assert.deepEqual(e.payload.cause, { kind: 'config', ref: 'ceremony-profile' });
  assert.equal(e.recordNumber, 7);
  assert.equal(e.runId, 'r1');
  assert.equal(e.repoName, 'acme/w');
  assert.equal(e.lane, 'unknown');
});

test('fixing the profile to standard after a fast-lane plan writes one replanned with reason other', () => {
  const { n, seen } = run([planLine(KIND.PLANNED, 'r1', 7, STARTING_LISTS['fast-lane'])], { lane: 'unknown', ceremonyProfile: 'standard' }, 'ceremony-profile');
  assert.equal(n, 1);
  assert.equal(seen[0].payload.reasonCode, REASON.OTHER);
  assert.equal(seen[0].payload.reasonText, 'ceremony profile standard');
  assert.deepEqual(seen[0].payload.stations, STARTING_LISTS.standard);
});

test('fixing the profile to standard after a standard claim writes nothing', () => {
  assert.equal(run([planLine(KIND.PLANNED, 'r1', 7, STARTING_LISTS.standard)], { lane: 'unknown', ceremonyProfile: 'standard' }, 'ceremony-profile').n, 0);
});

test('replanRun uses the replanned list as before', () => {
  const lines = [planLine(KIND.PLANNED, 'r1', 7, STARTING_LISTS.standard), planLine(KIND.REPLANNED, 'r1', 7, STARTING_LISTS['fast-lane'])];
  assert.equal(run(lines, { lane: 'unknown', ceremonyProfile: 'fast-lane' }, 'ceremony-profile').n, 0);
});

test('setting the lane to driver after a standard claim writes one replanned', () => {
  const { n, seen } = run([planLine(KIND.PLANNED, 'r1', 7, STARTING_LISTS.standard)], { lane: 'driver', ceremonyProfile: null }, 'lane');
  assert.equal(n, 1);
  assert.deepEqual(seen[0].payload.stations, STARTING_LISTS.driver);
  assert.equal(seen[0].payload.cause.ref, 'lane');
});

test('a claim line with lane driver keeps the driver list', () => {
  const lines = [planLine(KIND.PLANNED, 'r1', 7, STARTING_LISTS.driver, 'driver')];
  assert.equal(run(lines, { lane: 'standard', ceremonyProfile: 'standard' }, 'lane').n, 0);
});

test('replanRun without a stationEvent function reads nothing and returns 0', () => {
  let touched = 0;
  const fake = { readFileSync: () => { touched++; throw new Error('read'); } };
  assert.equal(replanRun({ runDir: '/x/pipelines/r1', manifest: { lane: 'unknown', ceremonyProfile: 'fast-lane' }, ref: 'x', deps: { mainRoot: '/x', fs: fake } }), 0);
  assert.equal(touched, 0);
});

test('a throwing sink never throws out of replanRun', () => {
  const { mainRoot, runDir } = setup([
    planLine(KIND.PLANNED, 'r1', 7, STARTING_LISTS.standard),
    planLine(KIND.PLANNED, 'r1', 8, STARTING_LISTS.standard),
  ]);
  let calls = 0;
  const n = replanRun({
    runDir, manifest: { lane: 'unknown', ceremonyProfile: 'fast-lane' }, ref: 'x',
    deps: { mainRoot, stationEvent: () => { calls++; if (calls === 1) throw new Error('boom'); } },
  });
  assert.equal(calls, 2);
  assert.equal(n, 1);
});

test('deps.now feeds the event discriminator', () => {
  const { seen } = run([planLine(KIND.PLANNED, 'r1', 7, STARTING_LISTS.standard)], { lane: 'unknown', ceremonyProfile: 'fast-lane' }, 'x');
  assert.equal(seen[0].discriminator, `replanned:${STARTING_LISTS['fast-lane'].join(',')}:2026-11-24T10:00:00.000Z`);
});

test('latestPlans skips a non-integer recordNumber and a non-string station', () => {
  const { mainRoot } = setup([
    planLine(KIND.PLANNED, 'r1', 'seven', STARTING_LISTS.standard),
    planLine(KIND.PLANNED, 'r1', 8, [STATION.BUILD, 5]),
    planLine(KIND.PLANNED, 'r1', 9, STARTING_LISTS.standard),
  ]);
  const map = latestPlans({ mainRoot, runId: 'r1' });
  assert.deepEqual([...map.keys()], [9]);
});
