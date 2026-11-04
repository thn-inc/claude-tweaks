'use strict';

// Persisted queue-ranking cache for dispatch's queue-pull script (#1571).
//
// Durable state lives on the same health-state git branch the four health
// skills and merge-lane-breaker.js already use (bin/lib/health-core/
// durable-state.js), under its own 'queue-order/' namespace — reusing that
// module's extracted createNamespacedState primitive rather than a bespoke
// branch. #1466 (closed) judged NOT extending durable-state.js with branch
// parameterization/raw-blob support worth the risk to createDurableState's
// byte-identical-behavior guarantee — so this consolidates on the primitive
// exactly as it exists today, a JSON namespace on the shared health-state
// branch, rather than the standalone 'queue-order' git ref the original
// design sketch anticipated before #1466 resolved.
//
// A cache is not a lock: writeOrder always overwrites unconditionally (the
// mutatorFn ignores prior namespace content) — two racing writers both
// attempt the write, the CAS loser's own in-memory groups/excluded remain
// valid for its own firing regardless of whether its write landed.

const { createNamespacedState } = require('../health-core/durable-state');
const { parseCrossRepoDependencies, parseCrossRepoRef } = require('../issues/cross-repo-refs');
const { withoutUnreadableSuffix } = require('../issues/record-dependencies');

const NAMESPACE = 'queue-order';

// #3278: dispatch groups per record, not by transitive file overlap — a blob's
// `grouping` stamp lets a cache hit refuse groups computed under the old rule.
const GROUPING_MODE = 'per-record';

// #4025: with the express lane on, express-eligible records stay out of
// fast-lane bundles, so those groups are stamped apart from GROUPING_MODE's.
function groupingMode(expressEnabled) {
  return expressEnabled ? 'per-record+express' : GROUPING_MODE;
}

function fileSpecs() {
  return [{ key: 'order', file: 'order.json', default: null }];
}

// opts: { run?, sleep? } — same injectable-runner shape createNamespacedState
// itself takes, threaded straight through for tests.
function store(opts) {
  return createNamespacedState(NAMESPACE, fileSpecs(), opts || {});
}

// -> the persisted order.json blob, or null (never written yet, or any read
// failure — readState's own contract already degrades to the spec default
// on a missing branch/file or fetch failure; this module adds no further
// fail-closed behavior since a cache read failure must always fall through
// to a normal full pull, never block one).
function readOrder(root, opts) {
  return store(opts).readState(root).order;
}

// Unconditional overwrite — never merges against `current`. Best-effort:
// callers must not treat a failed write as anything other than "the cache
// wasn't updated this time," per this design's own Gotchas (a write-back
// failure must never block or fail the firing that computed it).
function writeOrder(root, blob, opts) {
  return store(opts).writeState(root, () => ({ order: blob }));
}

// issues: [{number, updatedAt, state}] (any extra fields ignored) -> the
// blob's freshnessSignal.issues shape, deduped by number (last write wins —
// callers are expected to pass each number once, but this normalizes rather
// than trusting that).
//
// #4793: `foreignDeclared: true` is set (and the key is absent otherwise) when any issue's body
// declares a qualified 'Blocked by owner/name#N' line. A foreign issue closing changes nothing in
// this signal, so a hit would replay a stale foreign verdict (a record excluded as "state
// unreadable" would stay excluded in a quiet queue); cacheUsable treats the flag as a miss.
function buildFreshnessSignal(issues) {
  const byNumber = new Map();
  let foreignDeclared = false;
  for (const i of Array.isArray(issues) ? issues : []) {
    if (!i || typeof i.number !== 'number') continue;
    byNumber.set(i.number, { number: i.number, updatedAt: i.updatedAt, state: i.state });
    if (parseCrossRepoDependencies(i.body).length > 0) foreignDeclared = true;
  }
  return { issues: [...byNumber.values()], ...(foreignDeclared ? { foreignDeclared: true } : {}) };
}

// Exact-match comparison per AC1/AC2/AC3: same set of issue numbers, and for
// every number, the same updatedAt AND the same state. Any difference —
// an added/removed number, a changed updatedAt, or a changed state (the
// OPEN->CLOSED dependency-closure case, AC3) — is a mismatch, triggering a
// full recompute. Malformed input (missing/non-array `issues`) is always a
// mismatch, never a throw — this feeds a cache-hit/miss branch, not
// something worth failing the firing over.
function signalsMatch(persisted, current) {
  const pIssues = persisted && Array.isArray(persisted.issues) ? persisted.issues : null;
  const cIssues = current && Array.isArray(current.issues) ? current.issues : null;
  if (!pIssues || !cIssues) return false;
  if (pIssues.length !== cIssues.length) return false;
  const byNumber = new Map(pIssues.map((i) => [i.number, i]));
  for (const c of cIssues) {
    const p = byNumber.get(c.number);
    if (!p || p.updatedAt !== c.updatedAt || p.state !== c.state) return false;
  }
  return true;
}

// { computedAt, runId, freshnessSignal, groups, excluded, bundles, grouping }
// -> the exact blob shape written to order.json, stamped `grouping` (#3278;
// default GROUPING_MODE, groupingMode()'s value under #4025), the stamp
// cacheUsable checks. A thin composer, not a validator —
// callers already have every field in the right shape; this exists so the
// field list is stated once, matching claims.js's claimPayload/releasePayload
// precedent for this codebase's blob-shape convention. `bundles` (#2066) is
// optional and passed through as given — a caller reading a pre-upgrade blob
// with no `bundles` field gets `undefined` back and applies its own `[]`
// fallback (queue-pull-script.md's cache-hit path), never this module.
function composeOrderBlob({
  computedAt, runId, freshnessSignal, groups, excluded, bundles, grouping = GROUPING_MODE,
}) {
  return {
    computedAt, runId, freshnessSignal, groups, excluded, grouping,
    ...(bundles !== undefined ? { bundles } : {}),
  };
}

// #4793: true when a persisted exclusion ({number, blockedBy}[]) names a foreign blocker, i.e. a
// blockedBy entry that is an 'owner/name#N' string (optionally suffixed ' (state unreadable)'). A
// native or body-declared foreign blocker closing changes nothing in the freshness signal, so a
// hit would replay that exclusion after the blocker closed. Matched with cross-repo-refs.js's grammar.
function namesForeignBlocker(excluded) {
  return Array.isArray(excluded) && excluded.some((e) => e && Array.isArray(e.blockedBy)
    && e.blockedBy.some((b) => typeof b === 'string' && parseCrossRepoRef(withoutUnreadableSuffix(b)) !== null));
}

// A persisted blob is reusable only when stamped with the caller's current
// grouping rule (default GROUPING_MODE) AND its freshness signal still
// matches. A blob without `grouping` (any older plugin install's write) fails
// closed, and so does a current signal flagged `foreignDeclared` (buildFreshnessSignal, #4793)
// or a blob whose exclusions name a foreign blocker (namesForeignBlocker). Never throws.
function cacheUsable(persisted, current, grouping = GROUPING_MODE) {
  return !!persisted && persisted.grouping === grouping
    && !(current && current.foreignDeclared)
    && !namesForeignBlocker(persisted.excluded)
    && signalsMatch(persisted.freshnessSignal, current);
}

module.exports = {
  readOrder, writeOrder, buildFreshnessSignal, signalsMatch, composeOrderBlob,
  cacheUsable, GROUPING_MODE, groupingMode,
};
