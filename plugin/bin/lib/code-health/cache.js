'use strict';
const { createCache } = require('../health-core/cache');
const { createDurableState } = require('../health-core/durable-state');
const { computeChurn } = require('../health-core/runs');
const { mergeWontfixIntoDeclined } = require('../health-core/mark');

// Local, gitignored: cache.json only (open/closed/wontfix/regressed dedup —
// rebuildable from `gh issue list`, so it's fine to stay local/ephemeral).
// Canonical path: <root>/.claude-tweaks/code-health/cache.json (contract §cache.js)
// Shape: { "<fingerprint>": { status: 'open'|'wontfix'|'closed'|'regressed', issue: <number|null> } }
//
// Cursors, the sub-threshold "remembered" cache, the retry queue, and run
// history are durable instead — they live on the health-state branch (see
// _shared/health-state.md), not local disk, since local disk doesn't survive
// a scheduled cloud-routine firing's container recycling between runs.

const core = createCache('code-health');
// includeDeclined: true (#171) — a wontfix suppression read off a live
// GitHub label is also persisted to the durable `declined` slice, so it
// survives a scheduled cloud-Routine firing's container recycling the way
// the local cache (this module's other half) explicitly does not. See
// buildValidateFindingsUpdate below and dedup.js's `durableDeclined` param.
// createDurable({ env, stderr }) builds the durable-state accessors with an
// injected child-git environment and stderr sink (#5381) — an in-process caller
// passes its own; the module-level exports below are bound to createDurable()
// (inherited env, process.stderr).
function createDurable({ env, stderr } = {}) {
  const state = createDurableState('code-health', {
    includeRemembered: true, includeDeclined: true, env, stderr,
  });
  return { readDurableState: state.readState, writeDurableState: state.writeState };
}

const durable = createDurable();

// computeChurn (union-denominator ratio + the `stayed` field) is imported from
// health-core/runs.js, shared by all four health-suite engines, and re-exported
// below so bin/code-health.js and tests/bin-lib/code-health/* import it from
// this module.

// Pure: computes the next durable-state object for a validate-findings run.
// current: { cursors, remembered, retryQueue, runs } — the current durable
// health-state shape (as returned by readDurableState).
// opts: { areasSwept: string[], hashes: { [areaId]: string },
//         rememberCandidates: [{ id, severity, risk }],
//         runRecord: { runId, runAt, fingerprints }, now?: number }
//
// rememberCandidates (not a pre-computed delta object) so the "already
// remembered, don't touch it" check below is evaluated against THIS
// invocation's own `current.remembered` — writeDurableState's CAS loop calls
// its mutator fresh (a real refetch) on every retry attempt, so computing
// the delta here, inside the mutator, means the check always sees the
// freshest available state instead of a snapshot the caller read before the
// CAS loop even started (which could be stale by the time of the write —
// e.g. a concurrent code-health firing in the intervening window).
//
// This is the exact logic bin/code-health.js's cmdValidateFindings hands to
// writeDurableState as its mutator — extracted here (no git, no gh, no I/O)
// so its four behaviors (selective per-swept-area cursor update, un-swept-area
// cursor preservation, remembered-candidate merge, run-history append) can be
// unit tested directly with plain-object fixtures. See
// tests/bin-lib/code-health/build-validate-findings-update.test.js.
// wontfixSuppressed (#171): [fingerprint] — findings suppressed this run
// because their matching GitHub issue carries the `wontfix` label (dedup.js's
// decide() tags these with reason: 'wontfix-label'; the caller collects
// them). Folded into the durable `declined` slice so the suppression is
// still honored on a later firing whose local cache is empty — see
// dedup.js's `durableDeclined` param and health-core/mark.js's
// mergeWontfixIntoDeclined.
function buildValidateFindingsUpdate(current, { areasSwept, hashes, rememberCandidates, runRecord, wontfixSuppressed, now = Date.now() }) {
  const cursors = { ...current.cursors };
  for (const areaId of areasSwept) {
    const existing = cursors[areaId] || {};
    cursors[areaId] = {
      ...existing,
      lastSweptMs: now,
      ...(hashes[areaId] != null ? { lastHash: hashes[areaId] } : {}),
    };
  }
  const remembered = { ...current.remembered };
  for (const { id, severity, risk } of rememberCandidates || []) {
    if (!remembered[id]) {
      remembered[id] = { status: 'remembered', issue: null, severity, risk };
    }
  }
  return {
    ...current,
    cursors,
    remembered,
    declined: mergeWontfixIntoDeclined(current.declined, wontfixSuppressed, { now }),
    runs: [...current.runs, runRecord],
  };
}

module.exports = {
  cachePath: core.cachePath,
  readCache: core.readCache,
  writeCache: core.writeCache,
  computeChurn,
  createDurable,
  readDurableState: durable.readDurableState,
  writeDurableState: durable.writeDurableState,
  buildValidateFindingsUpdate,
};
