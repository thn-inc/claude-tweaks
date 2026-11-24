// plugin/bin/lib/station-events/plan.js — the starting station lists and the `planned` event a
// claim writes once per record and run (#6147). Pure: no I/O, never throws. Station, kind and
// reason names come from stations.js, never spelled here (the literal scan enforces it).
// Reference: docs/reference/station-events.md, `## Starting lists`.
'use strict';

const { STATION, STATIONS, LANES, KIND, REASON, PROCESS } = require('./stations');

const WITHOUT_POLISH = Object.freeze(STATIONS.filter((s) => s !== STATION.POLISH));

// List id -> the stations a record starts with.
const STARTING_LISTS = Object.freeze({
  standard: Object.freeze([...STATIONS]),
  'fast-lane': WITHOUT_POLISH,
  driver: WITHOUT_POLISH,
});

const LANE_DRIVER = 'driver';
const LANE_UNKNOWN = 'unknown';
const PROFILES = Object.freeze(['standard', 'fast-lane']);

function fresh(list, reasonCode, reasonText) {
  const plan = { list, stations: [...STARTING_LISTS[list]], reasonCode };
  if (reasonText !== undefined) plan.reasonText = reasonText;
  return plan;
}

// First match wins: lane driver, then a ceremony profile, then any other known lane, else the default.
function planOf(input) {
  const { lane, ceremonyProfile } = input !== null && typeof input === 'object' ? input : {};
  const knownLane = typeof lane === 'string' && LANES.includes(lane) && lane !== LANE_UNKNOWN ? lane : null;
  const profile = PROFILES.includes(ceremonyProfile) ? ceremonyProfile : null;
  if (knownLane === LANE_DRIVER) return fresh(LANE_DRIVER, REASON.OTHER, `lane ${LANE_DRIVER}`);
  if (profile) return fresh(profile, REASON.OTHER, `ceremony profile ${profile}`);
  if (knownLane) return fresh('standard', REASON.OTHER, `lane ${knownLane}`);
  return fresh('standard', REASON.DEFAULT_LIST);
}

// `listLane` chooses the list when it differs from the line's `lane`; `lane` goes to the line as given.
function planEvent({ repoName, recordNumber, lane, ceremonyProfile, sessionId, runId, listLane } = {}) {
  const { list, stations, reasonCode, reasonText } = planOf({ lane: listLane ?? lane, ceremonyProfile });
  const payload = { process: PROCESS.id, processVersion: PROCESS.version, list, stations, reasonCode };
  if (reasonText !== undefined) payload.reasonText = reasonText;
  return {
    repoName, recordNumber, kind: KIND.PLANNED, station: STATION.BUILD, outcome: null,
    lane, sessionId, runId, discriminator: `planned:${runId ?? ''}`, payload,
  };
}

module.exports = { STARTING_LISTS, planOf, planEvent };
