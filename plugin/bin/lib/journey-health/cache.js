'use strict';
const { createCache } = require('../health-core/cache');
const { createDurableState } = require('../health-core/durable-state');
const { mergeWontfixIntoDeclined } = require('../health-core/mark');

// Local, gitignored: cache.json only (rebuildable-from-issues dedup state).
// Canonical path: <root>/.claude-tweaks/journey-health/cache.json
//
// Cursors (per-journey light/deep audit + coverage-scan), the retry queue,
// and run history are durable instead — they live on the health-state
// branch (see _shared/health-state.md), not local disk, since local disk
// doesn't survive a scheduled cloud-routine firing's container recycling.

const core = createCache('journey-health');
// includeDeclined: true — a `mark ... declined` disposition also persists here
// (not just the local gitignored cache), so it survives a scheduled Routine's
// fresh, stateless container. See bin/lib/health-core/mark.js's own header
// comment and bin/journey-health.js's cmdMark wiring. No includeRemembered
// here — journey-health has no `remembered` tier, see comment below.

// createDurable({ env, stderr }) builds the durable-state accessors with an
// injected child-git environment and stderr sink (#5380); the module-level
// exports below are bound to createDurable() (inherited env, process.stderr),
// exactly as before.
function createDurable({ env, stderr } = {}) {
  const state = createDurableState('journey-health', { includeDeclined: true, env, stderr });
  return { readDurableState: state.readState, writeDurableState: state.writeState };
}

const durable = createDurable();

// Pure: computes the next durable-state object for a validate-findings run.
// current: { cursors, retryQueue, runs } — the current durable health-state
// shape (as returned by readDurableState). Like harness-health (and unlike
// code-health), journey-health has no `remembered` tier — every surviving
// finding files unconditionally — so there is no remembered-delta to merge
// here.
// opts: { target, tier, coverageScan, runRecord, deletedFileSig?, now? }
//
// `deletedFileSig` is the light tier's deleted-file acknowledgement (#131):
// the signature of the target journey's missing declared files as of this
// audit (scope.js's currentDeletedFileSignature), which scope.js's Phase 0
// compares against the live tree to decide whether a missing-file force-pick
// has already been reported. A string records it, `null` clears it (nothing
// missing any more), and `undefined` — the shape every deep-tier call and
// every pre-#131 caller passes — leaves whatever the cursor already holds
// untouched. Deep-tier audits never write it: Phase 0 is light-tier only, so
// a deep audit must not be able to suppress a light force-pick that never
// happened.
//
// This is the exact logic bin/journey-health.js's cmdValidateFindings hands
// to writeDurableState as its mutator — extracted here (no git, no gh, no
// I/O) so its behaviors (light/deep per-journey cursor merge, coverage-scan
// cursor set, unrelated cursor keys preserved, run-history append) can be
// unit tested directly with plain-object fixtures, the same way
// harness-health's buildValidateFindingsUpdate is tested in
// tests/bin-lib/harness-health/build-validate-findings-update.test.js — see
// tests/bin-lib/journey-health/build-validate-findings-update.test.js.
// Every CLI-level test that reaches cmdValidateFindings's persistence step
// fails its `git fetch origin health-state` first (no real GitHub-hosted
// remote configured in any test), so the mutator itself is never actually
// invoked by any CLI-level test.
// wontfixSuppressed: [fingerprint] — findings suppressed this run because
// their matching issue carried the `wontfix` label. Folded into the durable
// `declined` slice so the suppression outlives the issue index it was read
// from; see health-core/mark.js's mergeWontfixIntoDeclined.
function buildValidateFindingsUpdate(current, {
  target, tier, coverageScan, runRecord, deletedFileSig, wontfixSuppressed, now = Date.now(),
}) {
  const cursors = { ...current.cursors };
  if (target) {
    const existing = cursors[target] || {};
    const patch = tier === 'deep'
      ? { lastDeepAuditMs: now, lastDeepHash: null }
      : { lastLightAuditMs: now, lastLightHash: null };
    const next = { ...existing, ...patch };
    if (tier !== 'deep' && deletedFileSig !== undefined) {
      if (deletedFileSig === null) delete next.deletedFileSig;
      else next.deletedFileSig = deletedFileSig;
    }
    cursors[target] = next;
  }
  if (coverageScan) {
    cursors.__coverageScan = { lastScannedMs: now };
  }
  return {
    ...current,
    cursors,
    declined: mergeWontfixIntoDeclined(current.declined, wontfixSuppressed, { now }),
    runs: [...current.runs, runRecord],
  };
}

module.exports = {
  cachePath: core.cachePath,
  readCache: core.readCache,
  writeCache: core.writeCache,
  createDurable,
  readDurableState: durable.readDurableState,
  writeDurableState: durable.writeDurableState,
  buildValidateFindingsUpdate,
};
