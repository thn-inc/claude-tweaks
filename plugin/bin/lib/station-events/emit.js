// plugin/bin/lib/station-events/emit.js — appends one v1 station event line to
// `{main checkout}/.claude-tweaks/station-events.jsonl` (#5902). Local only: no
// network, no hub, no policy key. Never throws and never changes a caller's
// outcome — a refused or failed append is dropped with one stderr line.
// Line format and rules: docs/reference/station-events.md.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { withLock } = require('../file-lock');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');
const { STATIONS, LANES, KINDS, OUTCOMES } = require('./stations');

const LINE_VERSION = 1;
const REPO_NAME_RE = /^[^/\s]+\/[^/\s]+$/;

function stationEventPath(mainRoot) {
  return path.join(mainRoot, '.claude-tweaks', 'station-events.jsonl');
}

// `[host/]owner/name` -> `owner/name` (its last two segments), else null.
function toRepoName(slug) {
  if (typeof slug !== 'string') return null;
  const parts = slug.trim().split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const name = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  return REPO_NAME_RE.test(name) ? name : null;
}

// First 32 hex chars of sha256 over the identity fields joined by `|`; an
// absent field hashes as ''. `at` is deliberately not an input, so a re-emit of
// the same fact keys identically and consumers dedupe on it.
function eventKey({ repoName, recordNumber, kind, station, outcome, runId, discriminator }) {
  const field = (v) => (v === undefined || v === null ? '' : String(v));
  const joined = [repoName, recordNumber, kind, station, outcome, runId, discriminator].map(field).join('|');
  return crypto.createHash('sha256').update(joined).digest('hex').slice(0, 32);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function optionalString(v) {
  return typeof v === 'string' && v !== '' ? v : null;
}

// event -> why it cannot become a line, or null when it can.
function invalidReason(event) {
  if (!isPlainObject(event)) return 'event is not an object';
  if (typeof event.repoName !== 'string' || !REPO_NAME_RE.test(event.repoName)) return 'repoName is not owner/name';
  if (!Number.isInteger(event.recordNumber) || event.recordNumber <= 0) return 'recordNumber is not a positive integer';
  if (!KINDS.includes(event.kind)) return `kind outside the closed set: ${event.kind}`;
  if (!STATIONS.includes(event.station)) return `station outside the closed set: ${event.station}`;
  if (event.kind === 'exited' && !OUTCOMES.includes(event.outcome)) return `outcome outside the closed set: ${event.outcome}`;
  if (event.lane !== undefined && event.lane !== null && !LANES.includes(event.lane)) return `lane outside the closed set: ${event.lane}`;
  if (typeof event.discriminator !== 'string' || event.discriminator === '') return 'discriminator missing';
  return null;
}

function resolveAt(event, now) {
  const date = event.at !== undefined && event.at !== null ? new Date(event.at) : now();
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

// event -> the v1 line object, or null when the identity is unresolvable or a
// field falls outside its closed set.
function buildLine(event, deps = {}) {
  if (invalidReason(event) !== null) return null;
  const at = resolveAt(event, deps.now || (() => new Date()));
  if (at === null) return null;
  const outcome = event.kind === 'exited' ? event.outcome : null;
  const runId = optionalString(event.runId);
  return {
    v: LINE_VERSION,
    eventKey: eventKey({ ...event, outcome, runId }),
    repoName: event.repoName,
    recordNumber: event.recordNumber,
    kind: event.kind,
    station: event.station,
    at,
    outcome,
    lane: event.lane || 'unknown',
    sessionId: optionalString(event.sessionId),
    runId,
    payload: isPlainObject(event.payload) ? event.payload : {},
  };
}

// Each absent dep falls back to the real one; `mainRoot` is resolved from the
// cwd only when the caller passed none (an explicit null is kept and drops).
function resolveDeps(deps) {
  const d = isPlainObject(deps) ? deps : {};
  return {
    fs: d.fs || fs,
    withLock: d.withLock || withLock,
    mainRoot: Object.prototype.hasOwnProperty.call(d, 'mainRoot') ? d.mainRoot : mainCheckoutRoot(process.cwd()),
    now: d.now || (() => new Date()),
    stderr: d.stderr || ((s) => process.stderr.write(s)),
  };
}

function realDeps() {
  return resolveDeps({});
}

function drop(d, reason) {
  try { d.stderr(`claude-tweaks: station event dropped: ${reason}\n`); } catch { /* the drop line is best-effort too */ }
  return { written: false, reason };
}

function appendStationEvent(event, deps = {}) {
  let d = { stderr: () => true };
  try {
    d = resolveDeps(deps);
    const line = buildLine(event, d);
    if (line === null) return drop(d, invalidReason(event) || 'at is not a valid date');
    if (typeof d.mainRoot !== 'string' || d.mainRoot === '') return drop(d, 'main checkout not resolvable');
    const file = stationEventPath(d.mainRoot);
    d.fs.mkdirSync(path.dirname(file), { recursive: true });
    d.withLock(`${file}.lock`, () => d.fs.appendFileSync(file, `${JSON.stringify(line)}\n`), { createParent: true });
    return { written: true };
  } catch (err) {
    return drop(d, `append failed: ${err && err.message ? err.message : String(err)}`);
  }
}

module.exports = { appendStationEvent, buildLine, eventKey, toRepoName, stationEventPath, realDeps };
