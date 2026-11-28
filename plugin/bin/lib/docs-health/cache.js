'use strict';
const { createCache } = require('../health-core/cache');
const { createDurableState } = require('../health-core/durable-state');
const { mergeWontfixIntoDeclined } = require('../health-core/mark');

// Local, gitignored: cache.json only (rebuildable-from-issues dedup state).
// Canonical path: <root>/.claude-tweaks/docs-health/cache.json
//
// Cursors, the sub-threshold "remembered" cache, and run history are durable
// instead — they live on the health-state branch (see _shared/health-state.md),
// not local disk, since local disk doesn't survive a scheduled cloud-routine
// firing's container recycling.

const core = createCache('docs-health');
// includeRemembered: true — backs the --min-confidence floor (mirrors
// code-health's --min-risk / bin/lib/code-health/cache.js): a finding below
// the floor is held in this durable slice instead of being filed, until it
// escalates or a deeper sweep lowers the bar. See createDurableState's own
// header comment for why this must be an explicit opt-in flag rather than
// inferred from runtime truthiness of `current.remembered`.
// includeDeclined: true — a `mark ... declined` disposition also persists
// here (not just the local gitignored cache), so it survives a scheduled
// Routine's fresh, stateless container. See bin/lib/health-core/mark.js's
// own header comment and bin/docs-health.js's cmdMark wiring.
// createDurable({ env, stderr }) builds the durable-state accessors with an
// injected child-git environment and stderr sink (#5381) — an in-process caller
// passes its own; the module-level exports below are bound to createDurable()
// (inherited env, process.stderr).
function createDurable({ env, stderr } = {}) {
  const state = createDurableState('docs-health', {
    includeRemembered: true, includeDeclined: true, env, stderr,
  });
  return { readDurableState: state.readState, writeDurableState: state.writeState };
}

const durable = createDurable();

// Pure: computes the next durable-state object for a validate-findings run.
// current: { cursors, remembered, retryQueue, runs } — the current durable
// health-state shape (as returned by readDurableState). docs-health has a
// single kind ('doc') and no gap-scan concept, so this is simpler than
// harness-health's equivalent — no `kind` param, no `__gapScan` cursor.
// opts: { target, runRecord, rememberCandidates?: [{ id, confidence }], now? }
//
// rememberCandidates (not a pre-computed delta object), and the "already
// remembered, don't touch it" merge below, mirror
// bin/lib/code-health/cache.js's own buildValidateFindingsUpdate exactly —
// see that file's header comment for the full rationale (the check must be
// evaluated against `current.remembered`, the freshest state
// writeDurableState's CAS loop just fetched, not a caller-side snapshot).
// wontfixSuppressed: [fingerprint] — findings suppressed this run because
// their matching issue carried the `wontfix` label. Folded into the durable
// `declined` slice so the suppression outlives the issue index it was read
// from; see health-core/mark.js's mergeWontfixIntoDeclined.
function buildValidateFindingsUpdate(current, {
  target, runRecord, rememberCandidates, wontfixSuppressed, now = Date.now(),
}) {
  const cursors = { ...current.cursors };
  if (target) {
    cursors[`doc:${target}`] = { lastAuditedMs: now };
  }
  const remembered = { ...current.remembered };
  for (const { id, confidence } of rememberCandidates || []) {
    if (!remembered[id]) {
      remembered[id] = { status: 'remembered', issue: null, confidence };
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
  createDurable,
  readDurableState: durable.readDurableState,
  writeDurableState: durable.writeDurableState,
  buildValidateFindingsUpdate,
};
