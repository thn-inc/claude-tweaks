// bin/lib/issues/pending-authorization.js
// Shared "pending authorization" predicate over a record-facets object (the
// shape returned by record.js's parseRecordFacets): a record is pending
// authorization when it carries no auto:* grant and is not already in a
// bot:* state (in-progress, blocked, or parked). Extracted so /tidy Step 4.8's
// repo-wide scope and /help Stage 4.6's triage-queue scope (both in
// _shared/github-pr-scan.md) share one implementation instead of two
// independently hand-typed inline node -e boolean expressions — that exact
// duplication previously caused a real bug (Stage 4.6 once computed "pending"
// without excluding bot:blocked, so a blocked record double-counted as both
// pending and blocked on the same dashboard).
//
// Deliberately does NOT check facets.stage — callers differ on how stage is
// established: the triage-queue scope's `gh issue list --label ready` query
// already filters to ready-stage issues before this predicate ever runs, so
// re-checking stage here would be redundant; the repo-wide scope's query has
// no such label filter (it lists all open issues), so that caller adds its
// own `facets.stage === 'ready'` check alongside this predicate.
'use strict';

function isPendingAuthorization(facets) {
  return (
    !facets.grants.build &&
    !facets.grants.merge &&
    !facets.bot.inProgress &&
    !facets.bot.blocked &&
    !facets.bot.parked
  );
}

module.exports = { isPendingAuthorization };
