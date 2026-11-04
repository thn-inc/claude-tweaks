// bin/lib/issues/cross-repo-states.js — the state lookup for a foreign (other-repository) blocker
// (#4793). Native blockedBy nodes carry their own state; a body-declared 'Blocked by owner/name#N'
// line does not, so this module asks GitHub for it: fetchCrossRepoStates runs the one batched,
// aliased GraphQL call (buildCrossRepoStateQuery, cross-repo-refs.js) through an injectable runner;
// resolveForeignStates is the fail-closed spawn helper that skills' callers reach through
// bin/resolve-foreign-blockers.js; bodyForeignBlockers shapes the result per record.
//
// Failure posture (the plan's state-lookup constraint, spec Q5): a foreign ref whose state the lookup
// cannot read, for whatever reason, reads null (unreadable) and therefore blocks — the callers treat
// anything but exactly 'CLOSED' as blocking. The reasons: a missing alias, a null issue, a FORBIDDEN or
// NOT_FOUND alias, a number above GRAPHQL_INT_MAX (never sent), a whole-call failure, a non-zero CLI
// exit, or gh being absent. A whole-call failure also prints one 'Warning:' stderr line naming the
// cause, so a fail-closed stop is diagnosable rather than a silent fallback.
//
// A gh-absent transport (MCP, typically a cloud Routine) can supply the states itself: it reads each
// ref with issue_read and hands the answers to resolveForeignStates / bodyForeignBlockers as
// deps.states (a Map or a plain object) or deps.statesFile (a path to that JSON object) — see
// suppliedStates. A supplied ref is answered from there and never asked of the CLI; a ref left out
// follows the path above (so it still fails closed with gh absent). The input is an explicit option,
// never an ambient env var: the caller that wants the file (the dispatch queue pull) passes it.
//
// Partial data is always usable here: a missing alias can only make a record more blocked, never report
// a blocker landed. So fetchCrossRepoStates recovers ANY parseable `data` from a thrown
// `gh api graphql` call (gh exits non-zero when any alias errors, with the response on stdout). That is
// broader than preflight-records/blocker-landing.js's NOT_FOUND-only recovery, which guards a verdict
// that could otherwise read 'landed'.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  GRAPHQL_INT_MAX, parseCrossRepoDependencies, parseCrossRepoRef, crossRepoKey, distinctCrossRepoRefs, buildCrossRepoStateQuery, foreignEntries,
} = require('./cross-repo-refs');
const sharedPrimitives = require('../shared-primitives');

const { LARGE_MAX_BUFFER_BYTES } = sharedPrimitives;

const RESOLVE_CLI = path.join(__dirname, '..', '..', 'resolve-foreign-blockers.js');
// The CLI makes one gh call bounded by GH_BATCH_TIMEOUT_MS; the margin is process start and exit.
const SPAWN_TIMEOUT_MARGIN_MS = 5000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// refs -> [{ key, parsed }] (distinctCrossRepoRefs). Misuse throws a TypeError (non-array refs, an
// unparseable ref), like foreignEntries.
function distinctRefs(refs, who) {
  if (!Array.isArray(refs)) throw new TypeError(`${who}: refs must be an array`);
  const { distinct, invalid } = distinctCrossRepoRefs(refs);
  if (!distinct) throw new TypeError(`${who}: not an owner/name#N ref: ${invalid}`);
  return distinct;
}

// A state is readable only when it is exactly 'OPEN' or 'CLOSED' (spec Q5); anything else reads null.
const readableState = (state) => (state === 'OPEN' || state === 'CLOSED' ? state : null);

const sendable = ({ parsed }) => parsed.number <= GRAPHQL_INT_MAX;

// A supplied value -> its state: a string, or an object's `state` (the shape --blocker-states-json
// carries for this repository's numeric keys). MCP issue_read returns a lowercase state, so a string
// is case-folded here (the supplied path only; the GraphQL path's readableState stays exact) before
// readableState decides; anything else ('merged', a number) reads null.
const suppliedValue = (v) => {
  const state = isObject(v) ? v.state : v;
  return readableState(typeof state === 'string' ? state.toUpperCase() : state);
};

// Sets key in out, merging with what is already there: two spellings of one ref that differ only in
// case ('other/repo#5', 'OTHER/REPO#5') are one blocker, and a CLOSED must never override an OPEN or
// unreadable one, so the result is CLOSED only when every spelling says CLOSED (fail closed).
function setSupplied(out, key, value) {
  const prior = out.has(key) ? out.get(key) : 'CLOSED';
  out.set(key, prior === 'CLOSED' ? value : prior);
}

// A states object (or Map) keyed by 'owner/name#N' -> Map<crossRepoKey, 'OPEN'|'CLOSED'|null>. Keys
// are canonicalised like every other foreign key (case-insensitive owner/name, no leading zeros); a
// key that is not an owner/name#N ref (this repository's numeric keys share --blocker-states-json)
// is ignored. A value other than 'OPEN' or 'CLOSED' (any case) reads null: present, so the ref is not
// looked up, and unreadable, so it still blocks. Anything but an object or Map is no states.
function suppliedStates(input) {
  const out = new Map();
  const entries = input instanceof Map ? [...input] : isObject(input) ? Object.entries(input) : [];
  for (const [key, value] of entries) {
    const parsed = parseCrossRepoRef(key);
    if (parsed) setSupplied(out, crossRepoKey(parsed), suppliedValue(value));
  }
  return out;
}

// deps.states + deps.statesFile -> the supplied Map. A statesFile that is unset or empty is not
// asked for; one that is set but unreadable, unparseable or not a JSON object is no states and
// prints one Warning line, so a fail-closed stop that a missing file caused is diagnosable.
function loadedSupplied({ states, statesFile }, stderr) {
  const out = suppliedStates(states);
  if (typeof statesFile !== 'string' || !statesFile) return out;
  let why = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(statesFile, 'utf8'));
    if (isObject(parsed)) {
      for (const [key, value] of suppliedStates(parsed)) setSupplied(out, key, value);
    } else {
      why = 'not a JSON object';
    }
  } catch (err) {
    why = err instanceof SyntaxError ? 'not valid JSON' : oneLine(err && err.message ? err.message : err);
  }
  if (why) stderr(`Warning: foreign blocker states file ${statesFile} ignored (${why}) — supplied states not used (fail closed)\n`);
  return out;
}

// A thrown gh call -> its stdout's `data` object when that parses to one; else null (a whole-call failure).
function recoveredData(err) {
  if (!err || err.stdout == null) return null;
  let parsed;
  try { parsed = JSON.parse(String(err.stdout)); } catch { return null; }
  return parsed && isObject(parsed.data) ? parsed.data : null;
}

// { refs, host, runner } -> Map<crossRepoKey, 'OPEN'|'CLOSED'|null>, one entry per distinct ref.
// ONE `gh api graphql` call carrying every sendable ref; owner and name travel as String! variables
// (-f, never interpolated), the validated issue number is the only literal. A ref above GRAPHQL_INT_MAX
// is never sent and reads null (it must not fail the others). No sendable ref, no call. `host`
// (omitted / 'github.com' = no flag) threads --hostname for a GitHub Enterprise Server host.
// An alias that is missing, null, or whose issue.state is not exactly OPEN or CLOSED reads null. A thrown runner whose
// stdout carries a `data` object reads that data; any other throw (and a response with no `data`)
// propagates as a whole-call failure.
function fetchCrossRepoStates({ refs, host, runner } = {}) {
  const distinct = distinctRefs(refs, 'fetchCrossRepoStates');
  const states = new Map(distinct.map(({ key }) => [key, null]));
  const keys = distinct.filter(sendable).map(({ key }) => key);
  const built = buildCrossRepoStateQuery(keys);
  if (!built) return states;

  const args = ['api', 'graphql', '-f', `query=${built.query}`];
  for (const [name, value] of built.fields) args.push('-f', `${name}=${value}`);
  if (host && host !== 'github.com') args.push('--hostname', host);

  let data;
  try {
    const parsed = JSON.parse(runner(args));
    if (!parsed || !isObject(parsed.data)) {
      const errs = parsed && Array.isArray(parsed.errors) ? parsed.errors.map((e) => e && e.message).filter(Boolean) : [];
      throw new Error(`GraphQL response has no data${errs.length ? ` (GraphQL: ${errs.join('; ')})` : ''}`);
    }
    data = parsed.data;
  } catch (err) {
    data = recoveredData(err);
    if (!data) throw err;
  }

  keys.forEach((key, i) => {
    const node = data[`c${i}`];
    states.set(key, readableState(node && node.issue && node.issue.state));
  });
  return states;
}

const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

const realSpawn = (argv) => spawnSync(process.execPath, argv, {
  encoding: 'utf8',
  windowsHide: true,
  timeout: sharedPrimitives.GH_BATCH_TIMEOUT_MS + SPAWN_TIMEOUT_MARGIN_MS,
  maxBuffer: LARGE_MAX_BUFFER_BYTES,
});
const realStderr = (s) => process.stderr.write(s);

// A spawn result -> the cause text of a failure, or null when it succeeded (exit 0).
function failureCause(res) {
  if (!res) return 'no spawn result';
  if (res.error) return oneLine(res.error.message || res.error);
  if (res.status === 0) return null;
  const how = typeof res.status === 'number' ? `exit ${res.status}` : `signal ${res.signal || 'unknown'}`;
  const detail = oneLine(res.stderr || '');
  return detail ? `${how}: ${detail}` : how;
}

// refs + { spawn, stderr, states, statesFile } -> Map<crossRepoKey, string|null>. A ref in the supplied
// states (suppliedStates; deps.states / deps.statesFile) takes that state and is not asked of the CLI. Runs
// `node resolve-foreign-blockers.js <distinct sendable keys, comma-joined>` through deps.spawn(argv) (default:
// spawnSync(process.execPath, argv, …)) and maps its JSON line; a key the CLI does not answer, or
// answers with anything but OPEN or CLOSED, reads null; a ref above GRAPHQL_INT_MAX is not asked and reads null. Fails closed: a non-zero status, a spawn error, a signal or
// unparseable stdout reads EVERY ref null and prints one Warning line to deps.stderr. No refs, no spawn.
function resolveForeignStates(refs, deps = {}) {
  const { spawn = realSpawn, stderr = realStderr } = deps;
  const distinct = distinctRefs(refs, 'resolveForeignStates');
  const states = new Map(distinct.map(({ key }) => [key, null]));
  const supplied = loadedSupplied(deps, stderr);
  // An oversized ref stays null and is never spawned, like fetchCrossRepoStates: it must not
  // reach the CLI, where it would only add a no-op entry. A supplied ref is answered, not asked.
  const asked = distinct.filter((d) => sendable(d) && !supplied.has(d.key));
  for (const { key } of distinct.filter(sendable)) if (supplied.has(key)) states.set(key, supplied.get(key));
  if (asked.length === 0) return states;

  let cause;
  let answer;
  try {
    const res = spawn([RESOLVE_CLI, asked.map(({ key }) => key).join(',')]);
    cause = failureCause(res);
    if (!cause) {
      try { answer = JSON.parse(String(res.stdout || '').trim()); } catch { answer = null; }
      if (!isObject(answer)) cause = 'unparseable output';
    }
  } catch (err) {
    cause = oneLine(err && err.message ? err.message : err);
  }
  if (cause) {
    stderr(`Warning: foreign blocker state lookup failed (${cause}) — every body-declared foreign blocker reads state unreadable (fail closed)\n`);
    return states;
  }
  for (const { key } of asked) states.set(key, readableState(answer[key]));
  return states;
}

// records + deps (resolveForeignStates's) -> Map<number|id, Array<{number, repository, state}>>, one
// resolveForeignStates call over every record's body-declared foreign refs. A record with no foreign
// ref has no entry; the key is `r.number ?? r.id`. The entries are crossRepoBlockers-shaped
// (cross-repo-refs.js's foreignEntries), so the native world's consumers apply unchanged.
function bodyForeignBlockers(records, deps = {}) {
  const byRecord = new Map();
  for (const r of records || []) {
    const refs = parseCrossRepoDependencies(r && r.body);
    if (refs.length) byRecord.set(r.number ?? r.id, refs);
  }
  const states = resolveForeignStates([...byRecord.values()].flat(), deps);
  const out = new Map();
  for (const [id, refs] of byRecord) out.set(id, foreignEntries(refs, states));
  return out;
}

module.exports = { fetchCrossRepoStates, resolveForeignStates, bodyForeignBlockers, suppliedStates };
