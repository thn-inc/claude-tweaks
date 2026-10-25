'use strict';
// bin/lib/run-liveness/owner-pid-probe.js — the owner-pid probe, shared by
// runLiveness (index.js) and hooks/context.js's stampedOwnerProvablyAlive so both
// judge the stamped owner pid one way (#4153). Must require nothing: index.js reaches
// hooks/context.js through run-integrity.js and probes.js, so any require here that
// leads back to either would close a cycle.

// process.kill throws on a pid above int32 (ERR_INVALID_ARG_TYPE, not ESRCH), which
// isPidAlive reads as "gone" — no real pid is that large, so such a value is garbage,
// not a death witness.
const MAX_PID = 2 ** 31 - 1;

function errorMessage(err) {
  return err && err.message ? err.message : String(err);
}

// Run a probe; tag the outcome so a throw is "could not ask", never "no".
function call(fn, ...args) {
  try {
    return { ok: true, value: fn(...args) };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

function probeOwnerPid(owner, p) {
  if (!owner) return { result: 'negative', detail: 'no-owner-block' };
  const host = call(p.hostname);
  if (!host.ok) return { result: 'error', detail: host.message };
  if (owner.host !== host.value) return { result: 'negative', detail: 'other-host' };
  if (!Number.isInteger(owner.pid) || owner.pid <= 0 || owner.pid > MAX_PID) return { result: 'negative', detail: 'no-pid' };
  const alive = call(p.pidAlive, owner.pid);
  if (!alive.ok) return { result: 'error', detail: alive.message };
  if (!alive.value) return { result: 'negative', detail: 'gone', witness: true };
  if (owner.pidStartedAt === null || owner.pidStartedAt === undefined) {
    return { result: 'negative', detail: 'alive-no-start-time' };
  }
  // A stored start time that is not the raw `ps` string cannot be compared; it is
  // unjudgeable, not pid reuse.
  if (typeof owner.pidStartedAt !== 'string') return { result: 'error', detail: 'invalid-start-time' };
  const started = call(p.pidStartTime, owner.pid);
  if (!started.ok) return { result: 'error', detail: started.message };
  if (started.value === null || started.value === undefined) return { result: 'error', detail: 'start-time-unavailable' };
  if (started.value === owner.pidStartedAt) return { result: 'positive', detail: 'alive' };
  return { result: 'negative', detail: 'pid-reused', witness: true };
}

module.exports = { MAX_PID, errorMessage, call, probeOwnerPid };
