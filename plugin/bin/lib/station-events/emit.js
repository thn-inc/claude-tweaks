// plugin/bin/lib/station-events/emit.js — appends one v1 station event line to
// `{main checkout}/.claude-tweaks/station-events.jsonl` (#5902). Local only: no
// network, no hub, no policy key. Never throws and never changes a caller's
// outcome — a refused or failed append is dropped with one stderr line.
// Line format and rules: docs/reference/station-events.md.
// #5957: the log stays at its path; each append lists it and its lock in the main
// checkout's `.git/info/exclude` so an untracked log never reads as a dirty checkout.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { withLock } = require('../file-lock');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');
const {
  STATIONS, LANES, KIND, KINDS, OUTCOME, OUTCOMES, RETIRED_OUTCOMES, REASON_UNSPECIFIED, REASON_CODES, ACTORS, HOLD_WHYS,
} = require('./stations');

const LINE_VERSION = 1;
const REPO_NAME_RE = /^[^/\s]+\/[^/\s]+$/;

function stationEventPath(mainRoot) {
  return path.join(mainRoot, '.claude-tweaks', 'station-events.jsonl');
}

// Git patterns, always `/`-separated, anchored at the checkout root.
const EXCLUDE_ENTRIES = Object.freeze([
  '/.claude-tweaks/station-events.jsonl',
  '/.claude-tweaks/station-events.jsonl.lock',
]);

// Lists EXCLUDE_ENTRIES in `{mainRoot}/.git/info/exclude`, appending only the
// missing ones. true when both are present afterwards; false when `.git` is not a
// directory or any fs call threw. Never throws, writes nothing to stderr.
function ensureLocalExclude(mainRoot, fsImpl = fs) {
  try {
    const gitDir = path.join(mainRoot, '.git');
    if (!fsImpl.statSync(gitDir).isDirectory()) return false;
    const infoDir = path.join(gitDir, 'info');
    const excludeFile = path.join(infoDir, 'exclude');
    let existing = '';
    try {
      existing = fsImpl.readFileSync(excludeFile, 'utf8');
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    // Git strips only trailing spaces (and one `\r` before `\n`); a leading space or a
    // trailing tab makes a different pattern, so no other normalization is allowed.
    const present = new Set(existing.split('\n').map((l) => l.replace(/\r$/, '').replace(/ +$/, '')));
    const missing = EXCLUDE_ENTRIES.filter((e) => !present.has(e));
    if (missing.length === 0) return true;
    fsImpl.mkdirSync(infoDir, { recursive: true });
    const lead = existing !== '' && !existing.endsWith('\n') ? '\n' : '';
    fsImpl.appendFileSync(excludeFile, `${lead}${missing.join('\n')}\n`);
    return true;
  } catch {
    return false;
  }
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

const payloadOf = (event) => (isPlainObject(event.payload) ? event.payload : {});
const validStationList = (v) => Array.isArray(v) && v.every((st) => STATIONS.includes(st));
const validActor = (v) => typeof v === 'string' && ACTORS.test(v);

// Is this an `exited` on the new contract (stations.js, above OUTCOMES)? A pre-contract line is
// written unchanged: a retired outcome, or a passed/failed with no actor.
function isNewContractExit(event) {
  if (event.kind !== KIND.EXITED) return false;
  if (event.outcome === OUTCOME.SENT_BACK || event.outcome === OUTCOME.STOPPED) return true;
  return (event.outcome === OUTCOME.PASSED || event.outcome === OUTCOME.FAILED) && payloadOf(event).actor !== undefined;
}

// A payload value for a drop reason; never throws (a Symbol or a null-prototype object would
// make a template literal throw and turn the reason into "append failed").
function show(v) {
  try {
    const s = JSON.stringify(v);
    if (typeof s === 'string') return s;
  } catch { /* fall through */ }
  return typeof v;
}

// event -> the field a new-contract line gets wrong, or null. Never judges `reasonCode`.
function invalidContract(event) {
  const payload = payloadOf(event);
  if (isNewContractExit(event)) {
    if (!validActor(payload.actor)) return `payload.actor is not an agent, script, person or rule:name: ${show(payload.actor)}`;
    if (event.outcome === OUTCOME.SENT_BACK && !STATIONS.includes(payload.next)) return `payload.next is not a station: ${show(payload.next)}`;
  }
  if ((event.kind === KIND.HELD || event.kind === KIND.RELEASED) && !HOLD_WHYS.includes(payload.why)) return `payload.why outside the closed set: ${show(payload.why)}`;
  if ((event.kind === KIND.PLANNED || event.kind === KIND.REPLANNED) && !validStationList(payload.stations)) return `payload.stations is not a list of stations: ${show(payload.stations)}`;
  if (event.kind === KIND.DECIDED && !validActor(payload.actor)) return `payload.actor is not an agent, script, person or rule:name: ${show(payload.actor)}`;
  return null;
}

// The payload a line carries. A new-contract non-pass exit or a plan whose reasonCode is unknown
// or missing is written with REASON_UNSPECIFIED, the original kept in reasonText; the caller's
// object is never mutated.
function contractPayload(event) {
  const payload = payloadOf(event);
  const needsReason = event.kind === KIND.PLANNED || event.kind === KIND.REPLANNED
    || (isNewContractExit(event) && event.outcome !== OUTCOME.PASSED);
  if (!needsReason || REASON_CODES.includes(payload.reasonCode)) return payload;
  const original = payload.reasonCode;
  const copy = { ...payload, reasonCode: REASON_UNSPECIFIED };
  if (original !== undefined && original !== null && original !== '') {
    copy.reasonText = typeof payload.reasonText === 'string' ? `${String(original)}: ${payload.reasonText}` : String(original);
  }
  return copy;
}

// event -> why it cannot become a line, or null when it can.
function invalidReason(event) {
  if (!isPlainObject(event)) return 'event is not an object';
  if (typeof event.repoName !== 'string' || !REPO_NAME_RE.test(event.repoName)) return 'repoName is not owner/name';
  if (!Number.isInteger(event.recordNumber) || event.recordNumber <= 0) return 'recordNumber is not a positive integer';
  if (!KINDS.includes(event.kind)) return `kind outside the closed set: ${event.kind}`;
  if (!STATIONS.includes(event.station)) return `station outside the closed set: ${event.station}`;
  if (event.kind === KIND.EXITED && !OUTCOMES.includes(event.outcome) && !RETIRED_OUTCOMES.includes(event.outcome)) return `outcome outside the closed set: ${event.outcome}`;
  if (event.lane !== undefined && event.lane !== null && !LANES.includes(event.lane)) return `lane outside the closed set: ${event.lane}`;
  if (typeof event.discriminator !== 'string' || event.discriminator === '') return 'discriminator missing';
  return invalidContract(event);
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
  const outcome = event.kind === KIND.EXITED ? event.outcome : null;
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
    payload: contractPayload(event),
  };
}

function realStderr(s) {
  return process.stderr.write(s);
}

function stderrOf(deps) {
  return isPlainObject(deps) && typeof deps.stderr === 'function' ? deps.stderr : realStderr;
}

// Each absent dep falls back to the real one, resolved per append: an absent
// (undefined) `mainRoot` resolves from the cwd now, an explicit null drops.
function resolveDeps(deps) {
  const d = isPlainObject(deps) ? deps : {};
  return {
    fs: d.fs || fs,
    withLock: d.withLock || withLock,
    mainRoot: d.mainRoot !== undefined ? d.mainRoot : mainCheckoutRoot(process.cwd()),
    now: d.now || (() => new Date()),
    stderr: stderrOf(d),
  };
}

function drop(d, reason) {
  try { d.stderr(`claude-tweaks: station event dropped: ${reason}\n`); } catch { /* the drop line is best-effort too */ }
  return { written: false, reason };
}

function appendStationEvent(event, deps = {}) {
  let d = { stderr: realStderr };
  try {
    d = { stderr: stderrOf(deps) };
    d = resolveDeps(deps);
    const line = buildLine(event, d);
    if (line === null) return drop(d, invalidReason(event) || 'at is not a valid date');
    if (typeof d.mainRoot !== 'string' || d.mainRoot === '') return drop(d, 'main checkout not resolvable');
    const file = stationEventPath(d.mainRoot);
    d.fs.mkdirSync(path.dirname(file), { recursive: true });
    d.withLock(`${file}.lock`, () => {
      // Inside the lock so two concurrent appends do not both read the exclude as missing
      // and write its entries twice. The result is ignored on purpose: a failed exclude
      // write must not drop the event, and the next append retries it.
      ensureLocalExclude(d.mainRoot, d.fs);
      d.fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
    }, { createParent: true });
    return { written: true };
  } catch (err) {
    return drop(d, `append failed: ${err && err.message ? err.message : String(err)}`);
  }
}

module.exports = { appendStationEvent, buildLine, eventKey, toRepoName, stationEventPath, EXCLUDE_ENTRIES, ensureLocalExclude };
