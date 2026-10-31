'use strict';

// Global merge-lane circuit breaker for machine-granted merges (#311).
//
// A second, independent, additive layer over grant-gate.js's existing
// 5-gate chain: gates 1-5 answer "does this record earn a grant" (unchanged
// by this module); this module answers "is the merge lane itself currently
// trusted" — a whole-run fact, checked once per firing
// (skills/backlog/refine-headless.md's Step 0.5), not folded into the per-record
// gate loop. Independent from, not a replacement for, #268's per-class
// revocation (trust.js's resolveOperationalOutcome/trustRows) — a class can
// read 'clean' while this breaker is tripped, and vice versa. See
// skills/_shared/autonomy-ceiling.md's "Revocation" section for both
// mechanisms documented side by side.
//
// Scope is deliberately narrow: this gates ORIGINATION of new auto:merge
// grants only (grant-gate.js's `autoMerge` output). It does not retroactively
// strip auto:merge from records already granted before a trip fired.
//
// Durable state lives on the same health-state git branch the four health
// skills already use (bin/lib/health-core/durable-state.js), under its own
// 'merge-lane/' namespace — reusing that module's extracted
// createNamespacedState primitive (namespace + explicit {key,file,default}
// list) rather than createDurableState's fixed cursors/retryQueue/runs
// shape, which this record's breaker.json/watched.json pair does not fit.

const { createNamespacedState } = require('../health-core/durable-state');
const { discoverClosingCommits, isClosingCommitReverted } = require('./trust.js');
const { dispositionState } = require('./acceptance.js');
const { LABELS } = require('./record.js');

const NAMESPACE = 'merge-lane';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// { tripped, trippedAt, trippedBy: { record, reason } | null, resetAt, resetBy }
const DEFAULT_BREAKER = Object.freeze({ tripped: false, trippedAt: null, trippedBy: null, resetAt: null, resetBy: null });
// { [recordNumber: string]: { grantedAt: ISO8601, lastKnownState?: 'OPEN'|'CLOSED' } }
const DEFAULT_WATCHED = Object.freeze({});

function fileSpecs() {
  return [
    { key: 'breaker', file: 'breaker.json', default: DEFAULT_BREAKER },
    { key: 'watched', file: 'watched.json', default: DEFAULT_WATCHED },
  ];
}

// opts: { run?, sleep? } — same injectable-runner shape createDurableState
// takes, threaded straight through to createNamespacedState for tests.
function store(opts) {
  return createNamespacedState(NAMESPACE, fileSpecs(), opts || {});
}

// Fail-closed read (this record's own Deliverables bullet): distinguishes
// "branch/file genuinely never written" (empty defaults, tripped:false —
// mirrors durable-state.js's own "couldn't find remote ref" first-run case)
// from any other read failure (network/auth/timeout), which resolves
// tripped:true for THIS FIRING's decisions only — it does NOT persist a
// durable trip write. A transient read glitch self-corrects on the next
// firing rather than requiring a human reset for a problem that was never
// real (see this module's own Gotchas note in the record body).
//
// Returns the breaker.json shape, plus `transientReadFailure: true` only on
// the fail-closed branch (never present on a genuine read, tripped or not) —
// callers that only care about `.tripped` need nothing else.
function readBreakerState(root, opts) {
  const { values, fetchOk, missingRef } = store(opts).readStateWithMeta(root);
  if (!fetchOk && !missingRef) {
    return {
      ...DEFAULT_BREAKER,
      tripped: true,
      trippedBy: { record: null, reason: 'read-failure' },
      transientReadFailure: true,
    };
  }
  return values.breaker;
}

// mutatorFn: (currentBreaker) -> nextBreaker. The only two callers of this
// are refine-headless.md's Step 0.5 (trip on a watched-record classification) and
// refine-mode.md's grant sub-stage (the sole reset-to-false path — see
// classifyWatchedRecord below and skills/backlog/refine-mode.md).
function writeBreakerState(root, mutatorFn, opts) {
  return store(opts).writeState(root, (current) => ({ ...current, breaker: mutatorFn(current.breaker) }));
}

function readWatched(root, opts) {
  return store(opts).readStateWithMeta(root).values.watched;
}

// mutatorFn: (currentWatched) -> nextWatched. As of #309, the two maturation
// sites ADD an entry (seeded with { grantedAt }, at the moment a pending grant
// matures): dispatch's Auto-merge gate (settle-and-merge.md's Phase 2) and
// wrap-up's singleton short-circuit (auto-merge-short-circuit.md's
// Authorization step) — refine-headless.md's own Step 4 no longer seeds it directly.
// Step 0.5 is the only path that updates an existing entry's lastKnownState or
// prunes a resolved-good one — all go through this same function.
function writeWatched(root, mutatorFn, opts) {
  return store(opts).writeState(root, (current) => ({ ...current, watched: mutatorFn(current.watched) }));
}

// Pure classification of one watched record against fresh evidence — no I/O,
// reused directly by refine-headless.md's Step 0.5 per-entry loop.
//
// entry: {
//   number,                    // record number
//   grantedAt,                 // ISO8601 — from watched.json, unused here
//                               // (carried for caller convenience only)
//   lastKnownState,             // 'OPEN' | 'CLOSED' | undefined — the
//                               // watched.json entry's own last-observed
//                               // state, written back by a PRIOR firing's
//                               // Step 0.5 (absent on a record's first
//                               // classification, right after Phase C seeds
//                               // it while still open)
//   state,                      // 'OPEN' | 'CLOSED' — this firing's FRESH
//                               // gh issue view fetch
//   closedAt,                   // ISO8601 | null — only meaningful when
//                               // state is 'CLOSED'
//   labels,                     // string[] — this firing's fresh labels
//   closingCommitShas,          // string[] | undefined — from the issue
//                               // timeline, when the caller already
//                               // resolved it (discoverClosingCommits
//                               // prefers this over a commit-message scan)
// }
// gitLog: [{ sha, message }] — trust.js's parseGitLog shape, the
//   integration branch's full history.
// now: epoch milliseconds (injected clock).
// windowDays: the resolved trust-revert-window-days policy value.
//
// Returns exactly one of:
//   { action: 'trip', reason: 'demo:changes-requested' | 'accept:changes-requested' | 'revert' | 'reopened' }
//   { action: 'prune' }                        — resolved-good, drop from watched.json
//   { action: 'update', newState: 'OPEN' | 'CLOSED' }  — still-pending, leave in place
//     (newState is what Step 0.5 writes back as the entry's lastKnownState)
function classifyWatchedRecord(entry, gitLog, now, windowDays) {
  const rec = entry || {};
  const labels = Array.isArray(rec.labels) ? rec.labels : [];

  // A changes-requested acceptance verdict is checked first regardless of
  // open/closed state — a machine-granted record that a human explicitly
  // rejected at acceptance is the clearest possible signal, independent of the
  // merge/reopen timeline. dispositionState reads both label spellings under the
  // one precedence rule, so the verdict outranks a leftover pending label. The
  // reason names the spelling the record carries, preferring demo:* so the
  // existing reason pin holds.
  if (dispositionState(labels) === 'changes-requested') {
    return { action: 'trip', reason: labels.includes(LABELS.DEMO_CHANGES_REQUESTED) ? 'demo:changes-requested' : 'accept:changes-requested' };
  }

  // Reopen detection: the watched.json entry's own last-observed state
  // (written by a prior firing) was CLOSED, and this firing's fresh fetch
  // now shows OPEN. Reopening has no existing precedent elsewhere in this
  // codebase (trust.js's revert detector only ever looks at CLOSED records);
  // watched.json's per-entry lastKnownState field exists specifically to
  // make this comparison possible across firings without re-deriving it.
  if (rec.lastKnownState === 'CLOSED' && rec.state === 'OPEN') {
    return { action: 'trip', reason: 'reopened' };
  }

  if (rec.state !== 'CLOSED') {
    return { action: 'update', newState: 'OPEN' };
  }

  // Closed: reuse trust.js's shipped revert detector rather than re-deriving
  // git-log parsing (this record's own Technical Approach section).
  const closingShas = discoverClosingCommits({ number: rec.number, closingCommitShas: rec.closingCommitShas }, gitLog);
  if (closingShas.length === 0) {
    // Closed but no closing commit discoverable (yet) — outcome ungradable
    // this firing; stays watched and tracked as closed so a later reopen is
    // still detectable next time.
    return { action: 'update', newState: 'CLOSED' };
  }

  if (isClosingCommitReverted(closingShas, rec.number, gitLog)) {
    return { action: 'trip', reason: 'revert' };
  }

  const closedAtMs = typeof rec.closedAt === 'string' ? Date.parse(rec.closedAt) : NaN;
  // An unparseable/missing closedAt deliberately resolves ageDays to 0 rather
  // than an "unknown age" branch (contrast grant-maturation.js's
  // evaluateMaturation, which early-returns 'unknown-age' before ever
  // dividing) — both are fail-safe in the same direction, just shaped
  // differently for what each caller does next: age 0 here means "never
  // ages out on bad data," so the record stays watched (`update`/`CLOSED`
  // below) rather than being silently pruned from tracking.
  const ageDays = Number.isFinite(closedAtMs) ? (now - closedAtMs) / MS_PER_DAY : 0;
  if (ageDays >= windowDays) {
    return { action: 'prune' };
  }
  return { action: 'update', newState: 'CLOSED' };
}

module.exports = {
  NAMESPACE,
  DEFAULT_BREAKER,
  DEFAULT_WATCHED,
  readBreakerState,
  writeBreakerState,
  readWatched,
  writeWatched,
  classifyWatchedRecord,
};
