'use strict';

// Decide what to do with a freshly-fingerprinted finding given the current
// issue index and local cache. Pure — no I/O, no network, and asserted so by
// tests/bin-lib/health-core/purity.test.js. Consumed by the four health
// sweeps below only — bin/lib/residue/ does not require this module; it
// relies on fingerprint.js and finding-validation.js instead.
//
// Shared by harness-health, journey-health, and docs-health (byte-identical
// wrapper across the three today), and called directly by ci-audit.js's
// validate-findings with no local cache. code-health keeps its own decide() in
// bin/lib/code-health/dedup.js — it needs a `threshold`/`risk` comparison and
// a `remember` action (findings below the risk threshold are tracked but not
// filed) that this propose-then-approve cache vocabulary has no equivalent
// for, since code-health files findings directly rather than going through
// this module's declined/staged human-approval flow. Same divergence shape
// as bin/lib/health-core/runs.js's recordRun/computeChurn fork — see that
// file's header comment.
//
// issueIndex: precomputed map { "<fingerprint>": { number, state, labels } }
//   built by the calling skill from `gh issue list --label <skill>` output —
//   the engine never calls network.
//
// Decision logic:
//   open issue match             -> skip      (already filed, don't re-file)
//   wontfix-labelled issue       -> suppress  (standing decision — never re-propose)
//   closed non-wontfix match     -> reopen    (regressed)
//   'declined' in durableDeclined-> suppress  (user rejected this exact finding — durable form)
//   'declined' in local cache    -> suppress  (user rejected this exact finding — local-only form)
//   'staged' in local cache      -> skip      (already filed, unresolved)
//   'regressed' in local cache   -> skip      (already reopened via the issue-index path above on
//                                              some earlier run; a later run that falls back to
//                                              cache-only dedup — e.g. --issues unavailable — must
//                                              not re-file it as brand new)
//   otherwise                    -> file
//
// durableDeclined (optional 4th arg): a plain { "<fingerprint>": {...} } map
// of fingerprints a human explicitly declined, sourced from the health-state
// git branch (bin/lib/health-core/durable-state.js's `declined` slice) rather
// than the local gitignored cache — the cache alone does not survive a
// scheduled Routine firing's fresh, stateless container, so a declined
// finding with no filed GitHub issue (nothing for dedup to reconstruct from)
// would otherwise silently reappear on the next firing. Omitting this
// parameter preserves this function's pre-existing cache-only behavior
// exactly (backward compatible with every existing caller).
//
// `reason` on the two suppress outcomes is an EXPLICIT provenance tag, not a
// field callers should infer from the presence of `issue`. Only the
// wontfix-label branch is worth persisting durably (it is a fresh reading of
// live GitHub state that a later index-less firing cannot reconstruct); the
// durable/cache `declined` branches are already durable by construction, so
// re-persisting them would be a no-op write. Callers gate on
// `reason === 'wontfix-label'` — see validate-findings-dispatch.js's
// wontfixSuppressed collection.
function decide(finding, issueIndex, cache, durableDeclined) {
  const fp = finding.id;
  const match = issueIndex && fp && issueIndex[fp];
  if (match) {
    if ((match.labels || []).includes('wontfix')) {
      return { action: 'suppress', issue: match.number, reason: 'wontfix-label' };
    }
    // gh's real API returns state as uppercase 'OPEN'/'CLOSED' (confirmed
    // live: `gh issue list --json number,state,title`), not lowercase —
    // record.js's hasOpenNativeBlocker already checks GraphQL state this
    // same case-insensitive way for the identical reason.
    if (String(match.state).toLowerCase() === 'closed') {
      return {
        action: 'reopen',
        issue: match.number,
        note: 'regressed — this finding was previously closed and has reappeared',
      };
    }
    return { action: 'skip', issue: match.number };
  }
  if (durableDeclined && fp && durableDeclined[fp]) return { action: 'suppress', reason: 'declined' };
  const cached = cache && fp && cache[fp];
  if (cached && cached.status === 'declined') return { action: 'suppress', reason: 'declined' };
  if (cached && cached.status === 'staged') return { action: 'skip' };
  if (cached && cached.status === 'regressed') return { action: 'skip', issue: cached.issue };
  return { action: 'file' };
}

module.exports = { decide };
