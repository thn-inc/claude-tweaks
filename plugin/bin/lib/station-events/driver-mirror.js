// plugin/bin/lib/station-events/driver-mirror.js — maps one driver event line
// (run.js's sink) to the station events it records (#5902). Pure: no I/O.
// Step lines become a started/exited work segment; three merge sub-steps mark
// the merge-station visit boundary. Names live in stations.js.
'use strict';
const { ACTOR, DRIVER_STEP_STATIONS, KIND, MERGE_SUBSTEP_TRANSITIONS, OUTCOME, REASON, SESSION_BOUND_STATION, outcomeForDriverStatus } = require('./stations');

// Who does the work at each driver step: a model session, or the driver's own code.
const DRIVER_STEP_ACTORS = Object.freeze({
  worker: ACTOR.AGENT, test: ACTOR.AGENT, review: ACTOR.AGENT, pr: ACTOR.SCRIPT, ci: ACTOR.SCRIPT, merge: ACTOR.SCRIPT,
});
// The details steps.js's ciStep writes when it could not read the PR's checks.
const CI_READ_FAILURE_DETAILS = Object.freeze(['read-failed', 'gh-absent', 'no-pr']);

const own = (table, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
const nonEmpty = (v) => typeof v === 'string' && v !== '';

function isoOrNull(ms) {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// A red-tests stop (verifyExit 1) is a failure; any other stop is a stop. `verifyExit` is present only
// on the lines that decided from verify.js's exit code (steps.js).
function exitOutcome(step, event) {
  return step === 'test' && event.status === 'stop' && event.verifyExit === 1 ? OUTCOME.FAILED : outcomeForDriverStatus(event.status);
}

function exitPayload(step, event, outcome) {
  const payload = { step, actor: DRIVER_STEP_ACTORS[step] };
  if (outcome === OUTCOME.PASSED) return payload;
  if (step === 'test' && event.verifyExit === 1) payload.reasonCode = REASON.TEST_FAILED;
  else if (step === 'test' && event.status === 'fail' && Object.hasOwn(event, 'verifyExit')) payload.reasonCode = REASON.INFRASTRUCTURE;
  else if (step === 'ci' && CI_READ_FAILURE_DETAILS.includes(event.detail)) payload.reasonCode = REASON.INFRASTRUCTURE;
  else payload.reasonCode = REASON.UNSPECIFIED;
  if (outcome === OUTCOME.STOPPED && nonEmpty(event.detail)) payload.reasonText = event.detail;
  return payload;
}

// (driver event, { repoName, runId }) -> station events, [] when the line maps to none.
function stationEventsFor(event, { repoName, runId } = {}) {
  if (event === null || typeof event !== 'object') return [];
  const { step, ts, status } = event;
  const base = { repoName, recordNumber: event.record, lane: 'driver', runId, discriminator: `${step}@${ts}` };
  // The review fix round's own worker line (#5942) is not a work segment: the review line already spans it
  // and binds the fix session through `fixSessionId`.
  if (step === 'worker' && event.fix === true) return [];
  if (own(DRIVER_STEP_STATIONS, step)) {
    const station = DRIVER_STEP_STATIONS[step];
    // The sink writes one line at step end, so `started.at` is back-computed as the line's `ts`
    // minus `ms`. An unparseable `ts` makes isoOrNull return null and the emitter stamps the emit
    // time instead (docs/reference/station-events.md).
    const endMs = Date.parse(ts);
    const ms = Number.isFinite(event.ms) ? event.ms : 0;
    const out = [{ ...base, kind: 'started', station, at: isoOrNull(endMs - ms), payload: { step } }];
    const outcome = exitOutcome(step, event);
    if (outcome !== null) out.push({ ...base, kind: KIND.EXITED, station, at: ts, outcome, payload: exitPayload(step, event, outcome) });
    if (step === 'worker' && nonEmpty(event.sessionId)) {
      out.push({ ...base, kind: 'session_bound', station: SESSION_BOUND_STATION, at: ts, sessionId: event.sessionId, payload: { step } });
    }
    if (step === 'review' && nonEmpty(event.fixSessionId)) {
      out.push({ ...base, kind: 'session_bound', station: SESSION_BOUND_STATION, at: ts, sessionId: event.fixSessionId, payload: { step, fix: true } });
    }
    return out;
  }
  if (own(MERGE_SUBSTEP_TRANSITIONS, step)) {
    const t = MERGE_SUBSTEP_TRANSITIONS[step];
    // A failed sub-step marks no boundary (a ready-failed or unconfirmed stop entered or merged
    // nothing), except a park, which is itself the stop that returns the record.
    if (status !== 'ok' && t.outcome !== 'returned') return [];
    if (t.skipDetailPrefix && typeof event.detail === 'string' && event.detail.startsWith(t.skipDetailPrefix)) return [];
    const ev = { ...base, kind: t.kind, station: t.station, at: ts, payload: { substep: t.substep } };
    if (t.outcome) ev.outcome = t.outcome;
    return [ev];
  }
  return [];
}

module.exports = { stationEventsFor, DRIVER_STEP_ACTORS };
