// plugin/bin/lib/station-events/blockers.js — turns one
// fetchNativeDependencies entry into a `blockers` station event (#5902).
// Pass the returned sink as fetchNativeDependencies' `onSnapshot`.
'use strict';
const { BLOCKER_SNAPSHOT_STATION } = require('./stations');
const { toRepoName } = require('./emit');

// { stationEvent, sessionId, runId } -> (number, entry, meta) => void.
// Inert when `stationEvent` is not a function; a throwing `stationEvent` is
// swallowed, so the sink never throws.
function makeBlockerSnapshotSink({ stationEvent, sessionId, runId } = {}) {
  return (number, entry, meta) => {
    if (typeof stationEvent !== 'function') return;
    try {
      stationEvent({
        kind: 'blockers',
        station: BLOCKER_SNAPSHOT_STATION,
        recordNumber: number,
        repoName: toRepoName(`${meta.owner}/${meta.repo}`),
        lane: 'unknown',
        sessionId,
        runId,
        payload: {
          blockedBy: entry.blockedBy,
          openBlockerIds: entry.openBlockerIds,
          crossRepoBlockers: entry.crossRepoBlockers || [],
          fetchedAt: meta.fetchedAt,
        },
        discriminator: meta.fetchedAt,
      });
    } catch { /* a failed emit never reaches the fetch */ }
  };
}

// A CLI's deps -> the fetch's `onSnapshot`: an explicit `deps.onSnapshot` wins,
// else a sink over `deps.stationEvent`; neither present = undefined (no emission).
function snapshotSinkOf(deps) {
  if (deps.onSnapshot || typeof deps.stationEvent !== 'function') return deps.onSnapshot;
  return makeBlockerSnapshotSink({
    stationEvent: deps.stationEvent,
    sessionId: process.env.CLAUDE_CODE_SESSION_ID || null,
    runId: null,
  });
}

module.exports = { makeBlockerSnapshotSink, snapshotSinkOf };
