'use strict';
const { loadIssueIndex } = require('./issue-index');

// Shared cache-read + issueIndex-load + within-batch-dedup + decide/dispatch
// loop for every health producer's cmdValidateFindings (harness-health,
// journey-health, docs-health) — previously ~15 lines byte-for-byte
// duplicated across all three CLI entrypoints
// (bin/harness-health.js/bin/journey-health.js/bin/docs-health.js).
//
// deps: { readCache, decide, toIssuePayload } are each domain-specific
// (their own cache shape, dedup rules, and issue-payload projection), so
// they're injected rather than hardcoded here — this module owns only the
// dedup/dispatch control flow shared by all three, not the domain logic.
//
// opts: { root, issuesPath, toolName, survivors, verifiedAsOf, pluginVersion } — survivors is
// the caller's own array of already-validated, fingerprinted findings.
// verifiedAsOf (#117, optional): the git sha the caller resolved ONCE at the
// start of this run (health-core/read-commit.js) — passed straight through
// to toIssuePayload per finding, never re-resolved here. Absent/null is a
// valid value (git unavailable) and simply omits the stamp line downstream.
// pluginVersion (#1840, optional): the running plugin's own version, passed
// straight through as toIssuePayload's third argument, same never-resolved-
// here convention. Only harness-health's toIssuePayload reads it today; the
// other two producers' toIssuePayload signatures simply ignore the extra
// argument (JS calling convention), so this is safe to always pass through.
// Returns { cache, payloads, seen, wontfixSuppressed } — cache is the mutated
// in-memory cache object (the caller still owns persisting it via its own
// writeCache), payloads is the array of issue payloads to emit, seen is the
// Set of fingerprints processed this run (for the run-record's `fingerprints`
// field), and wontfixSuppressed is the array of fingerprints suppressed this
// run because their matching GitHub issue carries the `wontfix` label.
//
// wontfixSuppressed exists because the issue index is the ONLY place that
// reading lives, and it is exactly what a `gh`-absent (or GitHub-unreachable)
// firing cannot rebuild. A run that does have the index therefore has to hand
// the decision forward: the caller persists these fingerprints into the
// durable `declined` slice on the health-state branch, which does survive a
// scheduled Routine firing's fresh container (the local gitignored cache does
// not — see health-core/cache.js's header). Without this hand-off, a standing
// `wontfix` decision silently lapses the moment a firing can't reach GitHub,
// and the suppressed finding is re-filed as brand new.
function dedupAndDispatch({
  root, issuesPath, toolName, survivors, readCache, decide, toIssuePayload, verifiedAsOf, pluginVersion,
}) {
  const cache = readCache(root);
  const issueIndex = loadIssueIndex(issuesPath, toolName);
  const payloads = [];
  const seen = new Set();
  const wontfixSuppressed = [];
  for (const finding of survivors) {
    if (seen.has(finding.id)) continue;
    seen.add(finding.id);

    const decision = decide(finding, issueIndex, cache);
    if (decision.action === 'suppress') {
      if (decision.reason === 'wontfix-label') wontfixSuppressed.push(finding.id);
      continue;
    }
    if (decision.action === 'skip') continue;

    if (decision.action === 'file' || decision.action === 'reopen') {
      cache[finding.id] = decision.action === 'reopen'
        ? { status: 'regressed', issue: decision.issue || null, lastSeenMs: Date.now() }
        : { status: 'staged', lastSeenMs: Date.now() };
      payloads.push(toIssuePayload(finding, verifiedAsOf, pluginVersion));
    }
  }
  return { cache, payloads, seen, wontfixSuppressed };
}

module.exports = { dedupAndDispatch };
