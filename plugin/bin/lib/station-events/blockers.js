// plugin/bin/lib/station-events/blockers.js — turns one
// fetchNativeDependencies entry into a `blockers` station event (#5902).
// Pass the returned sink as fetchNativeDependencies' `onSnapshot`.
'use strict';
const fs = require('fs');
const { BLOCKER_SNAPSHOT_STATION, KIND } = require('./stations');
const { toRepoName, stationEventPath } = require('./emit');
const { LABELS } = require('../issues/record-vocabulary');

const TAIL_BYTES = 65536;

// The snapshot without its `fetchedAt`: what "changed" compares.
function withoutFetchedAt(p) {
  const { fetchedAt, ...rest } = p || {};
  return JSON.stringify(rest);
}

// previous payload | null, next payload -> true when the blocker set differs
// (or there is no previous), ignoring `fetchedAt`.
function blockersChanged(previous, next) {
  if (!previous || typeof previous !== 'object') return true;
  return withoutFetchedAt(previous) !== withoutFetchedAt(next);
}

// (repoName, number, mainRoot) -> the payload of the last `blockers` line for that
// record in the file's last TAIL_BYTES, or null. Never throws.
function lastBlockersPayload(repoName, number, mainRoot, fsImpl = fs) {
  try {
    const fd = fsImpl.openSync(stationEventPath(mainRoot), 'r');
    try {
      const size = fsImpl.fstatSync(fd).size;
      const len = Math.min(size, TAIL_BYTES);
      const buf = Buffer.alloc(len);
      fsImpl.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          const l = JSON.parse(lines[i]);
          if (l.kind === KIND.BLOCKERS && l.repoName === repoName && l.recordNumber === number) return l.payload;
        } catch { /* a cut first line or a bad line */ }
      }
    } finally { fsImpl.closeSync(fd); }
  } catch { /* no file yet */ }
  return null;
}

// { stationEvent, sessionId, runId, lastPayload } -> (number, entry, meta) => void.
// Inert when `stationEvent` is not a function; a throwing `stationEvent` is
// swallowed, so the sink never throws. `lastPayload(repoName, number)` supplies the
// previous snapshot; an unchanged one is not appended.
function makeBlockerSnapshotSink({ stationEvent, sessionId, runId, lastPayload } = {}) {
  return (number, entry, meta) => {
    if (typeof stationEvent !== 'function') return;
    try {
      const repoName = toRepoName(`${meta.owner}/${meta.repo}`);
      const payload = {
        blockedBy: entry.blockedBy,
        openBlockerIds: entry.openBlockerIds,
        crossRepoBlockers: entry.crossRepoBlockers || [],
        fetchedAt: meta.fetchedAt,
      };
      const previous = typeof lastPayload === 'function' ? lastPayload(repoName, number) : null;
      if (!blockersChanged(previous, payload)) return;
      stationEvent({
        kind: 'blockers',
        station: BLOCKER_SNAPSHOT_STATION,
        recordNumber: number,
        repoName,
        lane: 'unknown',
        sessionId,
        runId,
        payload,
        discriminator: meta.fetchedAt,
      });
    } catch { /* a failed emit never reaches the fetch */ }
  };
}

const HOLD_LABEL_WHY = Object.freeze({
  [LABELS.BOT_BLOCKED]: 'blocked',
  [LABELS.BOT_PARKED]: 'parked',
  [LABELS.ACCEPT_CHANGES_REQUESTED]: 'changes-requested',
});

// { label, added, recordNumber, repoName, station, lane, runId, sessionId, ref, discriminator, at }
// -> a `held` (added) / `released` event, or null for a label that is no hold. Pure and
// clock-free: the caller supplies `discriminator`; `at` (default null) lets the emitter
// stamp the emit time. `ref` rides only on `held`, and only as a string.
function holdEvent({
  label, added, recordNumber, repoName, station, lane, runId, sessionId, ref, discriminator, at,
} = {}) {
  const why = HOLD_LABEL_WHY[label];
  if (!why) return null;
  return {
    kind: added ? KIND.HELD : KIND.RELEASED,
    station,
    recordNumber,
    repoName,
    lane: lane || 'unknown',
    sessionId: sessionId === undefined ? null : sessionId,
    runId: runId === undefined ? null : runId,
    payload: added && typeof ref === 'string' ? { why, ref } : { why },
    discriminator,
    at: at === undefined ? null : at,
  };
}

// { stationEvent } -> (holdEvent args) => void. Inert without a function; a throwing
// `stationEvent` is swallowed, so a failed emit never reaches the transition.
function makeHoldSink({ stationEvent } = {}) {
  return (args) => {
    if (typeof stationEvent !== 'function') return;
    try {
      const event = holdEvent(args);
      if (event) stationEvent(event);
    } catch { /* a failed emit never reaches the transition */ }
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
    lastPayload: deps.lastPayload,
  });
}

module.exports = {
  makeBlockerSnapshotSink, snapshotSinkOf, blockersChanged, lastBlockersPayload, makeHoldSink,
  holdEvent, HOLD_LABEL_WHY,
};
