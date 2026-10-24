'use strict';
// bin/lib/run-liveness/index.js — a three-valued `live | dead | unknown` verdict
// for a pipeline run directory (#3973), built from POSITIVE evidence over
// injectable probes. No caller consumes it yet.
//
// Shape: gatherEvidence() asks every probe once and records a tagged entry
// ({ probe, result: positive | negative | error, detail }) plus the "death
// witnesses" the evidence amounts to; decideVerdict() is a pure function over
// that. "Could not ask" is an `error` entry — never folded into `negative` — so
// an unanswered probe can only ever push the verdict toward `unknown`.
//
// Precedence (decideVerdict): any positive among the four live probes -> live;
// else any error -> unknown; else any death witness -> dead; else unknown.
const path = require('path');
const ctxLib = require('../hooks/context');
const { lstatType } = require('../path-guard');
const { DEFAULT_PROBES } = require('./probes');
const { LIVE_WINDOW_MS, LEGACY_DEAD_MS } = require('./constants');

const PROBE_ORDER = ['owner-pid', 'heartbeat', 'worktree-lock', 'last-commit', 'owner-events'];
// owner-events is corroboration for the legacy witness, not a liveness probe.
const LIVE_PROBES = ['owner-pid', 'heartbeat', 'worktree-lock', 'last-commit'];

const RUN_ID_TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})(?:-|$)/;

// Run a probe; tag the outcome so a throw is "could not ask", never "no".
function call(fn, ...args) {
  try {
    return { ok: true, value: fn(...args) };
  } catch (err) {
    return { ok: false, message: err && err.message ? err.message : String(err) };
  }
}

// The run directory's creation time, from its run-id basename prefix
// (YYYY-MM-DDTHHMMSS, UTC). null when the basename carries none.
function runIdMs(runDir) {
  const m = RUN_ID_TS_RE.exec(path.basename(String(runDir)));
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d
    || back.getUTCHours() !== h || back.getUTCMinutes() !== mi || back.getUTCSeconds() !== s) return null;
  return ms;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function probeOwnerPid(owner, p) {
  if (!owner) return { result: 'negative', detail: 'no-owner-block' };
  const host = call(p.hostname);
  if (!host.ok) return { result: 'error', detail: host.message };
  if (owner.host !== host.value) return { result: 'negative', detail: 'other-host' };
  if (!Number.isInteger(owner.pid) || owner.pid <= 0) return { result: 'negative', detail: 'no-pid' };
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

function probeHeartbeat(owner, now) {
  if (!owner) return { result: 'negative', detail: 'no-owner-block' };
  const t = Date.parse(owner.heartbeatAt);
  if (Number.isNaN(t)) return { result: 'error', detail: 'unparseable heartbeatAt' };
  return now - t < LIVE_WINDOW_MS
    ? { result: 'positive', detail: 'fresh' }
    : { result: 'negative', detail: 'stale' };
}

// What the run-state's recorded worktree is on disk: { kind: 'none' } (nothing
// recorded, or provably absent), { kind: 'error', detail } (the type could not be
// established, or it is not a directory/symlink — never read as absent), or
// { kind: 'ok', path }.
function worktreeTarget(state, p) {
  if (typeof state.worktree !== 'string' || !state.worktree) return { kind: 'none' };
  const t = call(p.pathType, state.worktree);
  if (!t.ok) return { kind: 'error', detail: t.message };
  const type = t.value && t.value.type;
  if (type === 'missing') return { kind: 'none' };
  if (type === 'directory' || type === 'symlink') return { kind: 'ok', path: state.worktree };
  const code = t.value && t.value.code ? ` (${t.value.code})` : '';
  return { kind: 'error', detail: `worktree path is ${type || 'unclassified'}${code}` };
}

function probeLock(target, p) {
  if (target.kind === 'none') return { result: 'negative', detail: 'no-worktree' };
  if (target.kind === 'error') return { result: 'error', detail: target.detail };
  const r = call(p.lockInUse, target.path);
  if (!r.ok) return { result: 'error', detail: r.message };
  return r.value ? { result: 'positive', detail: 'in-use' } : { result: 'negative', detail: 'free' };
}

function probeCommit(target, p, now) {
  if (target.kind === 'none') return { result: 'negative', detail: 'no-worktree', absentOrOld: true };
  if (target.kind === 'error') return { result: 'error', detail: target.detail };
  const r = call(p.lastCommitAt, target.path);
  if (!r.ok) return { result: 'error', detail: r.message };
  if (r.value === null) return { result: 'negative', detail: 'no-commits', absentOrOld: true };
  if (!Number.isFinite(r.value)) return { result: 'error', detail: 'invalid last-commit time' };
  const age = now - r.value;
  if (age < LIVE_WINDOW_MS) return { result: 'positive', detail: 'recent' };
  return { result: 'negative', detail: `age:${age}`, absentOrOld: age >= LEGACY_DEAD_MS };
}

// ownerSessionId scopes the SessionEnd witness to the owner's own session
// (undefined = no owner block, legacy behavior; null = a block with no session id).
function probeOwnEvents(runDir, p, now, ownerSessionId) {
  const r = call(p.ownEventAt, runDir, ownerSessionId);
  if (!r.ok) return { entry: { result: 'error', detail: r.message }, lastSessionEndMs: null };
  const { lastOwnMs, lastSessionEndMs } = r.value || {};
  const bad = (v) => v !== null && v !== undefined && !Number.isFinite(v);
  if (bad(lastOwnMs) || bad(lastSessionEndMs)) {
    return { entry: { result: 'error', detail: 'invalid event time' }, lastSessionEndMs: null };
  }
  const sessionEnd = lastSessionEndMs ?? null;
  const ref = lastOwnMs ?? runIdMs(runDir);
  if (ref === null) return { entry: { result: 'error', detail: 'no-reference-time' }, lastSessionEndMs: sessionEnd };
  return {
    entry: now - ref < LEGACY_DEAD_MS ? { result: 'positive', detail: 'recent' } : { result: 'negative', detail: 'silent' },
    lastSessionEndMs: sessionEnd,
  };
}

// -> { evidence: [{ probe, result, detail }] (always all five, PROBE_ORDER),
//      witnesses: ('pid' | 'session-end' | 'legacy')[] }
function gatherEvidence(runDir, { now = Date.now(), probes = {} } = {}) {
  const p = { pathType: (wt) => lstatType(wt), ...DEFAULT_PROBES, ...probes };
  let state = {};
  try {
    const s = ctxLib.readRunState(runDir);
    if (isPlainObject(s)) state = s;
  } catch { /* unreadable run-state reads as legacy */ }
  const owner = isPlainObject(state.owner) ? state.owner : null;

  const target = worktreeTarget(state, p);

  // An owner block describing another session than the run's current one (an
  // older build re-stamped sessionId over it, or the block build failed) is not
  // evidence about the current session's process.
  const mismatch = owner !== null && typeof state.sessionId === 'string' && state.sessionId !== ''
    && state.sessionId !== owner.sessionId;
  const mismatched = { result: 'error', detail: 'owner-session-mismatch' };

  const pid = mismatch ? mismatched : probeOwnerPid(owner, p);
  const heartbeat = mismatch ? mismatched : probeHeartbeat(owner, now);
  const lock = probeLock(target, p);
  const commit = probeCommit(target, p, now);
  const events = probeOwnEvents(runDir, p, now, owner ? (owner.sessionId ?? null) : undefined);

  const results = [pid, heartbeat, lock, commit, events.entry];
  const evidence = PROBE_ORDER.map((probe, i) => ({ probe, result: results[i].result, detail: results[i].detail }));

  const witnesses = [];
  if (pid.witness) witnesses.push('pid');
  if (owner
    && (pid.detail === 'alive-no-start-time' || pid.detail === 'no-pid')
    && state.status === 'interrupted'
    && state.lastEvent === 'session-end'
    && events.lastSessionEndMs !== null
    && Date.parse(owner.heartbeatAt) < events.lastSessionEndMs) {
    witnesses.push('session-end');
  }
  if (!owner
    && lock.result === 'negative'
    && commit.result === 'negative' && commit.absentOrOld
    && events.entry.result === 'negative') {
    witnesses.push('legacy');
  }
  return { evidence, witnesses };
}

function decideVerdict({ evidence, witnesses }) {
  if (evidence.some((e) => LIVE_PROBES.includes(e.probe) && e.result === 'positive')) return 'live';
  if (evidence.some((e) => e.result === 'error')) return 'unknown';
  if (witnesses.length > 0) return 'dead';
  return 'unknown';
}

// Never throws: any internal failure reads as `unknown` with every probe an error.
function runLiveness(runDir, opts) {
  try {
    const { now = Date.now(), probes = {} } = isPlainObject(opts) ? opts : {};
    // Every age comparison goes false on a non-finite clock, which would read a
    // fresh heartbeat as stale — refuse to judge.
    if (!Number.isFinite(now)) {
      return { verdict: 'unknown', evidence: PROBE_ORDER.map((probe) => ({ probe, result: 'error', detail: 'invalid-now' })) };
    }
    const gathered = gatherEvidence(runDir, { now, probes });
    return { verdict: decideVerdict(gathered), evidence: gathered.evidence };
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    return { verdict: 'unknown', evidence: PROBE_ORDER.map((probe) => ({ probe, result: 'error', detail })) };
  }
}

module.exports = { PROBE_ORDER, gatherEvidence, decideVerdict, runLiveness };
