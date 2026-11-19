// plugin/bin/lib/station-events/stations.js — the one home of every station,
// lane, kind, outcome and mapping name a station event uses (#5902). A name
// correction is a one-file change here; no call site spells a station itself.
// Reference: docs/reference/station-events.md.
'use strict';

// Ordered: a record's journey from capture to acceptance.
// Names are unconfirmed pending the design's Phase 0 fixtures.
const STATIONS = Object.freeze([
  'intake', 'shape', 'authorize', 'release', 'build', 'test', 'review', 'polish', 'wrap-up', 'merge', 'accept',
]);

// Passed in by the caller, never inferred; `unknown` is valid.
const LANES = Object.freeze(['standard', 'express', 'driver', 'unknown']);

// `blockers` is an addition to the design's four kinds.
const KINDS = Object.freeze(['entered', 'started', 'exited', 'session_bound', 'blockers']);

// Carried only on `exited`; every other kind writes `outcome: null`.
const OUTCOMES = Object.freeze(['passed', 'failed', 'returned', 'skipped', 'abandoned']);

// The station a `blockers` snapshot is filed under.
// Unconfirmed reading: names are unconfirmed pending the design's Phase 0 fixtures.
const BLOCKER_SNAPSHOT_STATION = 'authorize';

// Driver step name -> station its started/exited work segment mirrors.
// Names are unconfirmed pending the design's Phase 0 fixtures.
const DRIVER_STEP_STATIONS = Object.freeze({
  worker: 'build',
  test: 'test',
  review: 'review',
  pr: 'wrap-up',
  ci: 'merge',
  merge: 'merge',
});

// Driver step status -> exited outcome.
// Names are unconfirmed pending the design's Phase 0 fixtures.
const DRIVER_STATUS_OUTCOMES = Object.freeze({ ok: 'passed', fail: 'failed', stop: 'returned' });

function outcomeForDriverStatus(status) {
  return Object.prototype.hasOwnProperty.call(DRIVER_STATUS_OUTCOMES, status) ? DRIVER_STATUS_OUTCOMES[status] : null;
}

// Driver merge sub-step -> the merge-station visit boundary it marks; each
// stamps `payload.substep`. `merge-confirm` counts only when its detail does not
// start with `skipDetailPrefix` (an armed auto-merge has not merged).
// `merge-call` is deliberately absent: it reports non-merges as `ok` too.
// Names are unconfirmed pending the design's Phase 0 fixtures.
const MERGE_SUBSTEP_TRANSITIONS = Object.freeze({
  'merge-ready': Object.freeze({ kind: 'entered', station: 'merge', substep: 'merge-ready' }),
  'merge-confirm': Object.freeze({ kind: 'exited', station: 'merge', outcome: 'passed', substep: 'merge-confirm', skipDetailPrefix: 'armed' }),
  'merge-park': Object.freeze({ kind: 'exited', station: 'merge', outcome: 'returned', substep: 'merge-park' }),
});

// Label edit -> the transitions it records, per the design's registry.
// `bot:blocked` / `bot:parked` are absent: the emitter cannot know which
// station's visit they end.
// Names are unconfirmed pending the design's Phase 0 fixtures.
const LABEL_TRANSITIONS = Object.freeze({
  'needs:definition': Object.freeze({
    removed: Object.freeze([{ kind: 'exited', station: 'intake', outcome: 'passed' }]),
  }),
  ready: Object.freeze({
    added: Object.freeze([
      { kind: 'exited', station: 'intake', outcome: 'passed' },
      { kind: 'exited', station: 'shape', outcome: 'passed' },
      { kind: 'entered', station: 'authorize' },
    ]),
  }),
  'auto:build': Object.freeze({
    added: Object.freeze([
      { kind: 'exited', station: 'authorize', outcome: 'passed' },
      { kind: 'entered', station: 'release' },
    ]),
  }),
  'bot:in-progress': Object.freeze({
    added: Object.freeze([
      { kind: 'exited', station: 'release', outcome: 'passed' },
      { kind: 'entered', station: 'build' },
    ]),
  }),
  'accept:pending': Object.freeze({
    added: Object.freeze([{ kind: 'entered', station: 'accept' }]),
  }),
});

// (label, 'added' | 'removed') -> fresh copies of its transitions, [] when none.
function transitionsForLabel(label, direction) {
  const entry = Object.prototype.hasOwnProperty.call(LABEL_TRANSITIONS, label) ? LABEL_TRANSITIONS[label] : null;
  const list = entry && Object.prototype.hasOwnProperty.call(entry, direction) ? entry[direction] : [];
  return list.map((t) => ({ ...t }));
}

// Claim-release reason -> exited outcome of the visit the release ends.
// Names are unconfirmed pending the design's Phase 0 fixtures.
function outcomeForReleaseReason(reason) {
  const r = typeof reason === 'string' ? reason : '';
  if (r === 'merged' || r.startsWith('pr-opened')) return 'passed';
  if (r.startsWith('never-started') || r.startsWith('swept:')) return 'abandoned';
  if (r.startsWith('fail')) return 'failed';
  return 'returned';
}

module.exports = {
  STATIONS, LANES, KINDS, OUTCOMES, BLOCKER_SNAPSHOT_STATION,
  DRIVER_STEP_STATIONS, MERGE_SUBSTEP_TRANSITIONS, LABEL_TRANSITIONS,
  outcomeForReleaseReason, outcomeForDriverStatus, transitionsForLabel,
};
