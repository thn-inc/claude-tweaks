// Pure: retry-ceiling tracking for autonomous build attempts — written by
// /claude-tweaks:dispatch's Settle step, read back by
// /claude-tweaks:assess-agent-autonomy's failure-check and /claude-tweaks:tidy.
// Each failed build attempt posts a human-readable comment (never a hidden
// marker) so a maintainer can see exactly what happened on every attempt.
// This module generates that comment body and counts prior attempts.
//
// #1963: the full comment always posts to the record's issue now (never
// only to a linked PR), but a record whose attempts predate this fix, or
// whose PR closed between runs, can still have earlier "Attempt N failed"
// comments scattered across the issue and one or more closed PRs.
// countFailedAttempts is source-agnostic by design — it counts whatever
// comment array it's given — so settle-and-merge.md's caller merges the
// issue's comments with every PR ever linked to the record (open or
// closed) before counting, rather than trusting one source alone.
'use strict';

const ATTEMPT_RE = /^Attempt (\d+) failed: /;

// Negative-evidence marker (#268): embedded in the same comment
// attemptFailedCommentBody already writes, only when `classification` is
// 'correctness' or 'ambiguous' — a 'transient' classification's path never
// carries it, satisfying trust.js's classification gate by construction
// (nothing downstream needs to re-check classification; its absence IS the
// gate). Line-anchored HTML-comment shape, matching record.js's
// work-fingerprint marker convention. The attempt number is carried for
// audit/debugging only — hasNegativeEvidenceMarker below is a boolean
// presence check, so N failed attempts on one record still contribute at
// most one unit of negative evidence to that record's class (idempotent by
// construction, not by counting).
const NEGATIVE_EVIDENCE_RE = /<!--\s*trust-negative-evidence:\s*attempt=\d+\s+classification=(?:correctness|ambiguous)\s*-->/;

function attemptFailedCommentBody({ attemptNumber, reason, ceilingHit, classification }) {
  const closing = ceilingHit
    ? 'Retry ceiling reached — no further automatic retries.'
    : 'Claim released, will retry.';
  const base = `Attempt ${attemptNumber} failed: ${reason}. ${closing}`;
  if (classification === 'correctness' || classification === 'ambiguous') {
    return `${base}\n\n<!-- trust-negative-evidence: attempt=${attemptNumber} classification=${classification} -->`;
  }
  return base;
}

// comments -> boolean. Read by trust.js's grading; also usable standalone by
// anything else that needs "has this record ever been marked negative"
// without pulling in the rest of trust.js. Presence-only (see the header
// comment above NEGATIVE_EVIDENCE_RE for why counting attempts is unnecessary).
function hasNegativeEvidenceMarker(comments) {
  return (Array.isArray(comments) ? comments : []).some((c) => NEGATIVE_EVIDENCE_RE.test((c && c.body) || ''));
}

function countFailedAttempts(comments) {
  return (comments || []).filter((c) => ATTEMPT_RE.test((c && c.body) || '')).length;
}

// `comments` must be the set of failure comments already posted BEFORE the
// attempt currently being evaluated — i.e. NOT including that attempt's own
// not-yet-posted comment (this mirrors skills/dispatch/SKILL.md's Settle-step
// fetch order: fetch comments, decide, then post). Returns whether the attempt
// currently being evaluated (attemptNumber = countFailedAttempts(comments) + 1)
// is at or past the ceiling, equivalent to dispatch's own inline
// `attemptNumber >= ceiling` check. A naive `countFailedAttempts(comments) >=
// ceiling` (comparing only already-posted comments against the ceiling) is off
// by one for this — it stays false through the attempt that IS the
// ceiling-hitting one.
function hasHitRetryCeiling(comments, ceiling = 3) {
  return countFailedAttempts(comments) + 1 >= ceiling;
}

module.exports = {
  attemptFailedCommentBody, countFailedAttempts, hasHitRetryCeiling, hasNegativeEvidenceMarker,
};
