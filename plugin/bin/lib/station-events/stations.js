// plugin/bin/lib/station-events/stations.js — the one home of every station,
// lane, kind, outcome and mapping name a station event uses (#5902). A name
// correction is a one-file change here; no call site under plugin/bin spells a station itself
// (tests/bin-lib/station-events/station-literal-conformance.test.js scans for it).
// Reference: docs/reference/station-events.md.
// "The design" in the notes below is the factory floor design: docs/superpowers/specs/2026-11-18-factory-floor-design.md
// in the thn-inc/dispatch repository (dispatch PR #1894) — its "The ledger: station events"
// section and its station registry table. "Unconfirmed pending the design's Phase 0 fixtures"
// marks a name or reading this file chose where that design does not pin it.
'use strict';

const { LABELS } = require('../issues/record-vocabulary');

// Ordered: a record's journey from capture to acceptance. Call sites name a
// station through STATION (or a helper below), never by string.
// Names are unconfirmed pending the design's Phase 0 fixtures.
const STATION = Object.freeze({
  INTAKE: 'intake', SHAPE: 'shape', AUTHORIZE: 'authorize', RELEASE: 'release', BUILD: 'build', TEST: 'test',
  REVIEW: 'review', POLISH: 'polish', WRAP_UP: 'wrap-up', MERGE: 'merge', ACCEPT: 'accept',
});
const STATIONS = Object.freeze(Object.values(STATION));

// A `session_bound` event (a claim's, a driver worker's or a review fix's) is filed under the
// build station: that is where the bound session works.
const SESSION_BOUND_STATION = STATION.BUILD;

// pr-early-open's point fact: a PR opened or reopened for a record is `started` at the build
// station with `payload.fact: PR_OPENED_FACT`. It has no `exited` pair and no `payload.step`.
const PR_OPENED_FACT = 'pr_opened';
const PR_OPENED_TRANSITION = Object.freeze({ kind: 'started', station: STATION.BUILD });

// Passed in by the caller, never inferred; `unknown` is valid.
const LANES = Object.freeze(['standard', 'express', 'driver', 'unknown']);

// `blockers` is an addition to the design's four kinds; `planned`/`replanned` carry a record's station list,
// `held`/`released` a hold, `decided` a person's or rule's decision.
const KIND = Object.freeze({
  ENTERED: 'entered', STARTED: 'started', EXITED: 'exited', SESSION_BOUND: 'session_bound', BLOCKERS: 'blockers',
  PLANNED: 'planned', REPLANNED: 'replanned', HELD: 'held', RELEASED: 'released', DECIDED: 'decided',
});
const KINDS = Object.freeze(Object.values(KIND));

// Carried only on `exited`; every other kind writes `outcome: null`. An `exited` is on the
// new contract (it must carry a valid `payload.actor`) when its outcome is `sent-back` or
// `stopped`, or when it is `passed`/`failed` and carries an actor at all; a `passed`/`failed`
// without one, and every RETIRED_OUTCOMES line, is pre-contract and is written unchanged.
const OUTCOME = Object.freeze({ PASSED: 'passed', SENT_BACK: 'sent-back', FAILED: 'failed', STOPPED: 'stopped' });
const OUTCOMES = Object.freeze(Object.values(OUTCOME));
// Still accepted until the emitters that write them are migrated (record 8/8).
const RETIRED_OUTCOMES = Object.freeze(['returned', 'skipped', 'abandoned']);

// Why an exit was not a pass, or why a plan was made. A caller's unknown or missing code is
// normalized to REASON_UNSPECIFIED by emit.js, never dropped.
// Call sites name a code through REASON.*, never as a string (the literal scan enforces it).
const REASON = Object.freeze({
  UNSPECIFIED: 'unspecified', DEFAULT_LIST: 'default-list', INFRASTRUCTURE: 'infrastructure', TEST_FAILED: 'test-failed',
  SPEC_WRONG: 'spec-wrong', SCOPE_TOO_BIG: 'scope-too-big', BLOCKED_BY_OTHER: 'blocked-by-other',
  CHANGES_REQUESTED: 'changes-requested', SUPERSEDED: 'superseded', WITHDRAWN: 'withdrawn',
  CEREMONY_DOWNGRADE: 'ceremony-downgrade', DOCUMENTS_ONLY: 'documents-only', OTHER: 'other',
});
const REASON_UNSPECIFIED = REASON.UNSPECIFIED;
const REASON_CODES = Object.freeze(Object.values(REASON));

// Who made an exit or a decision: `agent`, `script`, `person` or `rule:{name}`. Call sites name
// an actor through ACTOR.*, never as a string.
const ACTOR = Object.freeze({
  AGENT: 'agent', SCRIPT: 'script', PERSON: 'person', rule: (id) => `rule:${id}`,
});
const ACTORS = /^(?:agent|script|person|rule:[^\s:]+)$/;

// Why a record is held, on `held` and `released` lines.
const HOLD_WHYS = Object.freeze(['blocked', 'parked', 'changes-requested', 'waiting-on-you']);

// The process a `planned` line names.
const PROCESS = Object.freeze({ id: 'build-a-record', version: 1 });

// The station a `blockers` snapshot is filed under: blocker state decides whether an authorized
// record can be released to build, the closest reading of where blocker state matters.
// Unconfirmed reading: names are unconfirmed pending the design's Phase 0 fixtures.
const BLOCKER_SNAPSHOT_STATION = STATION.AUTHORIZE;

// Driver step name -> station its started/exited work segment mirrors. `pr` -> `wrap-up`: opening
// the PR is the driver's wrap-up step, and the design has no separate PR station (an unconfirmed
// reading).
// Names are unconfirmed pending the design's Phase 0 fixtures.
const DRIVER_STEP_STATIONS = Object.freeze({
  worker: STATION.BUILD,
  test: STATION.TEST,
  review: STATION.REVIEW,
  pr: STATION.WRAP_UP,
  ci: STATION.MERGE,
  merge: STATION.MERGE,
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
  'merge-ready': Object.freeze({ kind: 'entered', station: STATION.MERGE, substep: 'merge-ready' }),
  'merge-confirm': Object.freeze({ kind: 'exited', station: STATION.MERGE, outcome: 'passed', substep: 'merge-confirm', skipDetailPrefix: 'armed' }),
  'merge-park': Object.freeze({ kind: 'exited', station: STATION.MERGE, outcome: 'returned', substep: 'merge-park' }),
});

// Label edit -> the transitions it records, per the design's registry. The `release` station
// spans the authorized-but-unclaimed wait, from `auto:build` added to `bot:in-progress` added; a
// claim release (releaseTransition below) is a different thing and exits `build`.
// `bot:blocked` / `bot:parked` are absent: the emitter cannot know which
// station's visit they end.
// Names are unconfirmed pending the design's Phase 0 fixtures.
const LABEL_TRANSITIONS = Object.freeze({
  [LABELS.NEEDS_DEFINITION]: Object.freeze({
    removed: Object.freeze([{ kind: 'exited', station: STATION.INTAKE, outcome: 'passed' }]),
  }),
  [LABELS.READY]: Object.freeze({
    added: Object.freeze([
      { kind: 'exited', station: STATION.INTAKE, outcome: 'passed' },
      { kind: 'exited', station: STATION.SHAPE, outcome: 'passed' },
      { kind: 'entered', station: STATION.AUTHORIZE },
    ]),
  }),
  [LABELS.AUTO_BUILD]: Object.freeze({
    added: Object.freeze([
      { kind: 'exited', station: STATION.AUTHORIZE, outcome: 'passed' },
      { kind: 'entered', station: STATION.RELEASE },
    ]),
  }),
  [LABELS.BOT_IN_PROGRESS]: Object.freeze({
    added: Object.freeze([
      { kind: 'exited', station: STATION.RELEASE, outcome: 'passed' },
      { kind: 'entered', station: STATION.BUILD },
    ]),
  }),
  [LABELS.ACCEPT_PENDING]: Object.freeze({
    added: Object.freeze([{ kind: 'entered', station: STATION.ACCEPT }]),
  }),
});

// (label, 'added' | 'removed') -> fresh copies of its transitions, [] when none.
function transitionsForLabel(label, direction) {
  const entry = Object.prototype.hasOwnProperty.call(LABEL_TRANSITIONS, label) ? LABEL_TRANSITIONS[label] : null;
  const list = entry && Object.prototype.hasOwnProperty.call(entry, direction) ? entry[direction] : [];
  return list.map((t) => ({ ...t }));
}

// Claim-release reason -> exited outcome of the visit the release ends. The families are the
// real release vocabulary: `_shared/issue-claims.md`'s Release triggers table (`merged: spec N`,
// `pr-opened: spec N`, `abandoned: spec N`, `failed: {gate}`, `swept: ...`), claim-targets'
// `never-started: ...` rollback, accept-park's `awaiting-local-acceptance` (the build visit hands
// forward into accept, so it passed) and the driver's `drive.js settle: {outcome} at {step}`.
// An unrecognised reason stays `returned`.
// Names are unconfirmed pending the design's Phase 0 fixtures.
const word = (name) => new RegExp(`^${name}(?:[:\\s]|$)`);
const RELEASE_PASSED = [word('merged'), word('pr-opened'), /^awaiting-local-acceptance$/, /^drive\.js settle: pending-review(?:\s|$)/];
const RELEASE_ABANDONED = [word('abandoned'), word('never-started'), /^swept:/, /^drive\.js settle: refused(?:\s|$)/];
const RELEASE_FAILED = [word('failed'), /^drive\.js settle: blocked(?:\s|$)/];

function outcomeForReleaseReason(reason) {
  const r = typeof reason === 'string' ? reason : '';
  if (RELEASE_PASSED.some((re) => re.test(r))) return 'passed';
  if (RELEASE_ABANDONED.some((re) => re.test(r))) return 'abandoned';
  if (RELEASE_FAILED.some((re) => re.test(r))) return 'failed';
  return 'returned';
}

// A shaping claim (`/specify`'s headless drain, specify/next-mode-shape.md's Release step) is
// released with `shaped: #n`, `routed: needs:definition #n` or `failed: shaping`. It never entered
// the build station, and the design's shape station has no `entered` producer to pair an exit
// with, so a shaping release is no station transition.
const SHAPING_RELEASE = [/^shaped(?::|\s|$)/, /^routed(?::|\s|$)/, /^failed: shaping\s*$/];

// Claim-release reason -> the station transition the release makes, or null when it makes none:
// a fresh `{ kind: 'exited', station, outcome }` that the caller spreads into its event.
function releaseTransition(reason) {
  const r = typeof reason === 'string' ? reason : '';
  if (SHAPING_RELEASE.some((re) => re.test(r))) return null;
  return { kind: 'exited', station: STATION.BUILD, outcome: outcomeForReleaseReason(r) };
}

module.exports = {
  STATION, STATIONS, LANES, KIND, KINDS, OUTCOME, OUTCOMES, RETIRED_OUTCOMES, REASON, REASON_UNSPECIFIED, REASON_CODES, ACTOR, ACTORS, HOLD_WHYS, PROCESS,
  BLOCKER_SNAPSHOT_STATION, SESSION_BOUND_STATION,
  PR_OPENED_FACT, PR_OPENED_TRANSITION,
  DRIVER_STEP_STATIONS, MERGE_SUBSTEP_TRANSITIONS, LABEL_TRANSITIONS,
  outcomeForReleaseReason, releaseTransition, outcomeForDriverStatus, transitionsForLabel,
};
