'use strict';
const { createCache } = require('../health-core/cache');
const { createDurableState } = require('../health-core/durable-state');
const { mergeWontfixIntoDeclined } = require('../health-core/mark');

// Local, gitignored: cache.json only (rebuildable-from-issues dedup state).
// Canonical path: <root>/.claude-tweaks/harness-health/cache.json
//
// Cursors (per-target audit + gap-scan), the retry queue, run history, the
// `remembered` sub-`--min-confidence`-floor cache, and the `declined` mark
// (see bin/lib/health-core/mark.js's own header comment) are durable
// instead — they live on the health-state branch (see
// _shared/health-state.md), not local disk, since local disk doesn't
// survive a scheduled cloud-routine firing's container recycling. Both
// includeRemembered and includeDeclined are opted into explicitly here
// (decided once, at construction) rather than inferred from runtime data
// shape — see durable-state.js's own header comment on buildFiles for why
// truthiness of an always-present default object is not a safe signal.

const core = createCache('harness-health');
const durable = createDurableState('harness-health', { includeRemembered: true, includeDeclined: true });

// Pure: computes the next durable-state object for a validate-findings run.
// current: { cursors, remembered, declined, retryQueue, runs } — the current
// durable health-state shape (as returned by readDurableState).
// opts: { target, kind, gapScan, runRecord, rememberCandidates, now? }
//
// rememberCandidates: [{ id, confidence }] — findings that fell below a
// `--min-confidence` floor this run (mirrors code-health's own
// rememberCandidates shape in bin/lib/code-health/cache.js, minus the
// severity/risk fields that vocabulary doesn't have here). Held, not
// dropped, not filed — the same "already remembered, don't touch it" merge
// semantics as code-health's.
//
// This is the exact logic bin/harness-health.js's cmdValidateFindings hands
// to writeDurableState as its mutator — extracted here (no git, no gh, no
// I/O) so its behaviors (target+kind cursor set, gap-scan cursor set,
// unrelated cursor keys preserved, remembered-candidate merge, run-history
// append) can be unit tested directly with plain-object fixtures, the same
// way code-health's buildValidateFindingsUpdate is tested in
// tests/bin-lib/code-health/build-validate-findings-update.test.js — see
// tests/bin-lib/harness-health/build-validate-findings-update.test.js.
// Every CLI-level test that reaches cmdValidateFindings's persistence step
// fails its `git fetch origin health-state` first (no real GitHub-hosted
// remote configured in any test), so the mutator itself is never actually
// invoked by any CLI-level test.
// wontfixSuppressed: [fingerprint] — findings suppressed this run because
// their matching issue carried the `wontfix` label. Folded into the durable
// `declined` slice so the suppression outlives the issue index it was read
// from; see health-core/mark.js's mergeWontfixIntoDeclined.
function buildValidateFindingsUpdate(current, {
  target, kind, gapScan, runRecord, rememberCandidates, wontfixSuppressed, now = Date.now(),
}) {
  const cursors = { ...current.cursors };
  if (target && kind) {
    cursors[`${kind}:${target}`] = { lastAuditedSha: null, lastAuditedMs: now };
  }
  if (gapScan) {
    cursors.__gapScan = { lastScannedSha: null, lastScannedMs: now };
  }
  const remembered = { ...current.remembered };
  for (const { id, confidence } of rememberCandidates || []) {
    if (!remembered[id]) {
      remembered[id] = { status: 'remembered', confidence };
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
  readDurableState: durable.readState,
  writeDurableState: durable.writeState,
  // Local-only recording + the explicit once-per-row push (#2545) — only
  // cmdValidateFindings uses these; cmdMark keeps writeDurableState's
  // existing push-every-call behavior unchanged (out of this change's scope).
  writeDurableStateLocal: durable.writeStateLocal,
  pushDurableState: durable.pushState,
  buildValidateFindingsUpdate,
};
