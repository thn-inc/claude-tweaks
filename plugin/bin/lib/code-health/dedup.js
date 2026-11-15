// Risk rank: lower number = more urgent (highest priority to file).
const RISK_RANK = { high: 0, medium: 1, low: 2 };

// code-health's own fork of bin/lib/health-core/dedup.js — not a thin wrapper
// like the other three health skills use, because code-health needs the
// `threshold`/`risk` comparison and `remember` action below, which have no
// equivalent in health-core's declined/staged human-approval cache vocabulary.
// See health-core/dedup.js's header comment for the full rationale.
//
// Decide what to do with a freshly-fingerprinted finding given the current issue
// index and local cache. Pure — no I/O, no network.
//
// issueIndex: precomputed map { "<fingerprint>": { number, state, labels } }
//   built from gh issue list output (the skill builds it; engine never calls network).
//   state: lowercase from the loader; compared case-insensitively for a hand-built index
//
// Decision logic (contract §dedup.js):
//   open issue match         -> skip      (no flood)
//   wontfix-labelled issue   -> suppress  (standing decision)
//   closed non-wontfix match -> reopen    (regressed)
//   wontfix in cache         -> suppress
//   new >= threshold         -> file
//   new <  threshold         -> remember
//
// Filing gates on the computed `risk` tier (severity x likelihood — see
// bin/lib/code-health/risk.js#computeRisk), not raw severity.
function decide(finding, issueIndex, cache, opts) {
  const threshold = (opts && opts.threshold) || 'high';
  // durableDeclined (optional, #171): a plain { "<fingerprint>": {...} } map
  // of fingerprints suppressed on some earlier firing because their matching
  // GitHub issue carried the `wontfix` label — sourced from the health-state
  // git branch's `declined` slice (bin/lib/health-core/durable-state.js),
  // never the local gitignored cache. code-health's own cache-level wontfix
  // check below (`cached.status === 'wontfix'`) is not durable across a
  // scheduled Routine firing's fresh, stateless container; this is its
  // durable twin. See bin/lib/code-health/cache.js's buildValidateFindingsUpdate
  // for the write side (health-core/mark.js's mergeWontfixIntoDeclined).
  const durableDeclined = opts && opts.durableDeclined;
  // finding.id is the derived, trusted fingerprint hash computed in Phase 1
  // (cmdValidateFindings always sets it, overriding any same-named key on the
  // raw finding). finding.fingerprint is only a fallback for a finding that
  // never went through that derivation — it must NOT take precedence over an
  // already-present finding.id, since validateFindingV2 echoes back unknown
  // keys verbatim and nothing forbids a raw LLM-produced finding from
  // carrying a stray/hallucinated `fingerprint` field of its own. Preferring
  // the untrusted field here would let such a value silently redirect
  // dedup/issue-index/cache lookups to the wrong key (the same shape as the
  // spoofed-"kind" claim-marker-parser bug).
  const fp = finding.id || finding.fingerprint;
  const match = issueIndex && fp && issueIndex[fp];
  if (match) {
    // `reason: 'wontfix-label'` is a fresh reading of live GitHub state — the
    // caller (bin/code-health.js) collects fingerprints carrying this reason
    // into `wontfixSuppressed` and persists them into the durable `declined`
    // slice, exactly the hand-off health-core/dedup.js's own match branch
    // documents (validate-findings-dispatch.js's wontfixSuppressed collection).
    // The cache-level and durable-level suppress branches below are already
    // durable/persisted by construction, so they deliberately carry no reason
    // — re-persisting them would be a no-op write.
    if ((match.labels || []).includes('wontfix')) return { action: 'suppress', issue: match.number, reason: 'wontfix-label' };
    if (String(match.state).toLowerCase() === 'closed') {
      return {
        action: 'reopen',
        issue: match.number,
        note: 'regressed — this finding was previously closed and has reappeared',
      };
    }
    return { action: 'skip', issue: match.number };
  }
  const cached = cache && fp && cache[fp];
  if (cached && cached.status === 'wontfix') return { action: 'suppress', issue: cached.issue };
  // Durable twin of the cache-level check above: the local cache does not
  // survive a scheduled Routine firing's fresh container, so a wontfix
  // suppression persisted durably on an earlier firing (one that DID have
  // gh/network access) must still be honored here rather than silently
  // re-filed. mergeWontfixIntoDeclined only ever stores the fingerprint (no
  // issue number), so this branch always reports issue: null — consistent
  // with the fact that reaching it means no live issueIndex match existed
  // for this fingerprint this run either.
  if (durableDeclined && fp && durableDeclined[fp]) return { action: 'suppress', issue: null };
  const rank = RISK_RANK[finding.risk];
  const thresholdRank = RISK_RANK[threshold];
  if (rank !== undefined && thresholdRank !== undefined && rank <= thresholdRank) return { action: 'file' };
  return { action: 'remember' };
}

module.exports = { decide, RISK_RANK };
