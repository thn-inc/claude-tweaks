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
// Partial data is always usable here: a missing alias can only make a record more blocked, never report
// a blocker landed. So fetchCrossRepoStates recovers ANY parseable `data` from a thrown
// `gh api graphql` call (gh exits non-zero when any alias errors, with the response on stdout). That is
// broader than preflight-records/blocker-landing.js's NOT_FOUND-only recovery, which guards a verdict
// that could otherwise read 'landed'.
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const {
  GRAPHQL_INT_MAX, parseCrossRepoDependencies, parseCrossRepoRef, crossRepoKey, buildCrossRepoStateQuery, foreignEntries,
} = require('./cross-repo-refs');
const sharedPrimitives = require('../shared-primitives');

const { LARGE_MAX_BUFFER_BYTES } = sharedPrimitives;

const RESOLVE_CLI = path.join(__dirname, '..', '..', 'resolve-foreign-blockers.js');
// The CLI makes one gh call bounded by GH_BATCH_TIMEOUT_MS; the margin is process start and exit.
const SPAWN_TIMEOUT_MARGIN_MS = 5000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// refs -> [{ key, parsed }], one per distinct crossRepoKey in first-seen order. Misuse throws a
// TypeError (non-array refs, an unparseable ref), like foreignEntries.
function distinctRefs(refs, who) {
  if (!Array.isArray(refs)) throw new TypeError(`${who}: refs must be an array`);
  const seen = new Set();
  const out = [];
  for (const ref of refs) {
    const parsed = parseCrossRepoRef(ref);
    if (!parsed) throw new TypeError(`${who}: not an owner/name#N ref: ${ref}`);
    const key = crossRepoKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, parsed });
  }
  return out;
}

// A thrown gh call -> its stdout's `data` object when that parses to one; else null (a whole-call failure).
function recoveredData(err) {
  if (!err || err.stdout == null) return null;
  let parsed;
  try { parsed = JSON.parse(String(err.stdout)); } catch { return null; }
  return parsed && isObject(parsed.data) ? parsed.data : null;
}

// { refs, host, runner } -> Map<crossRepoKey, 'OPEN'|'CLOSED'|string|null>, one entry per distinct ref.
// ONE `gh api graphql` call carrying every sendable ref; owner and name travel as String! variables
// (-f, never interpolated), the validated issue number is the only literal. A ref above GRAPHQL_INT_MAX
// is never sent and reads null (it must not fail the others). No sendable ref, no call. `host`
// (omitted / 'github.com' = no flag) threads --hostname for a GitHub Enterprise Server host.
// An alias that is missing, null, or has no string issue.state reads null. A thrown runner whose
// stdout carries a `data` object reads that data; any other throw (and a response with no `data`)
// propagates as a whole-call failure.
function fetchCrossRepoStates({ refs, host, runner } = {}) {
  const distinct = distinctRefs(refs, 'fetchCrossRepoStates');
  const states = new Map(distinct.map(({ key }) => [key, null]));
  const sendable = distinct.filter(({ parsed }) => parsed.number <= GRAPHQL_INT_MAX).map(({ key }) => key);
  const built = buildCrossRepoStateQuery(sendable);
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

  sendable.forEach((key, i) => {
    const node = data[`c${i}`];
    const state = node && node.issue && node.issue.state;
    states.set(key, typeof state === 'string' ? state : null);
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

// refs + { spawn, stderr } -> Map<crossRepoKey, string|null>. Runs
// `node resolve-foreign-blockers.js <distinct keys, comma-joined>` through deps.spawn(argv) (default:
// spawnSync(process.execPath, argv, …)) and maps its JSON line; a key the CLI does not answer, or
// answers with a non-string, reads null. Fails closed: a non-zero status, a spawn error, a signal or
// unparseable stdout reads EVERY ref null and prints one Warning line to deps.stderr. No refs, no spawn.
function resolveForeignStates(refs, deps = {}) {
  const { spawn = realSpawn, stderr = realStderr } = deps;
  const distinct = distinctRefs(refs, 'resolveForeignStates');
  const states = new Map(distinct.map(({ key }) => [key, null]));
  if (distinct.length === 0) return states;

  let cause;
  let answer;
  try {
    const res = spawn([RESOLVE_CLI, distinct.map(({ key }) => key).join(',')]);
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
  for (const { key } of distinct) {
    if (typeof answer[key] === 'string') states.set(key, answer[key]);
  }
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

module.exports = { fetchCrossRepoStates, resolveForeignStates, bodyForeignBlockers };
