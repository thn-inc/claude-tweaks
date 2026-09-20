'use strict';

// Supporting code for the pipeline-smoke-test skill's Step 4 (record #44):
// the claim-race exercise's own pass/fail computation, over live claim state
// -- never either racing process's self-report. Both attempting run
// identities are known ahead of time (this skill spawned both processes), so
// the verdict is purely: did exactly one of those two identities end up
// holding the live claim, and is `bot:in-progress` present exactly once?

/**
 * attemptRunIds: [string, string] -- the two racing processes' own run
 *   identities, known by construction (this skill minted both).
 * liveClaim: { runId: string } | null -- the record's live claim state after
 *   both processes have exited, read independently (`_shared/issue-claims.md`'s
 *   "Reading claim state").
 * inProgressLabelCount: number -- how many times `bot:in-progress` appears on
 *   the record's live label list (GitHub labels are set-valued; a double-apply
 *   bug is a distinct failure from a double-claim bug, and both are checked).
 *
 * Returns { pass: boolean, reason: string, winner: string|null }.
 */
function verifyClaimRaceOutcome(attemptRunIds, liveClaim, inProgressLabelCount) {
  const [a, b] = Array.isArray(attemptRunIds) ? attemptRunIds : [];
  if (!a || !b) {
    return { pass: false, reason: 'two distinct attempting run ids are required to verify a race', winner: null };
  }
  if (a === b) {
    return { pass: false, reason: 'the two attempts must use distinct run ids to prove genuine concurrency, not one process racing itself', winner: null };
  }
  if (!liveClaim || !liveClaim.runId) {
    return { pass: false, reason: 'neither attempt holds a live claim afterward -- the race protection itself has a hole', winner: null };
  }
  if (liveClaim.runId !== a && liveClaim.runId !== b) {
    return { pass: false, reason: `live claim belongs to neither attempting run id (got ${liveClaim.runId})`, winner: null };
  }
  if (inProgressLabelCount !== 1) {
    return {
      pass: false,
      reason: `bot:in-progress must be present exactly once, found ${inProgressLabelCount}`,
      winner: liveClaim.runId,
    };
  }
  return { pass: true, reason: 'exactly one attempt holds the live claim, bot:in-progress applied exactly once', winner: liveClaim.runId };
}

module.exports = { verifyClaimRaceOutcome };
