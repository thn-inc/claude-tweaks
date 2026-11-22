'use strict';
// The driver's one reading of a claim-targets.js exit code. The claim step (steps.js) writes the
// stop reason from it, settle.js picks its row, its comment's exit code and its note from that
// reason, and the --budget loop (budget.js) picks its counter and whether the run ends from the
// exit. All three ask here what a code means, so a new exit is one row of KIND_BY_EXIT.
//
// Pure: no file call, nothing spawned.

const CLAIM_KIND = Object.freeze({
  // 0: the CLI ran to its end. It may still have claimed nothing (the claim step checks).
  OK: 'ok',
  // 3: contested or in flight. Another run holds the claim.
  CONTESTED: 'contested',
  // 7: the token may not write the claim.
  PERMISSION_DENIED: 'permission-denied',
  // 2 (malformed invocation or missing dependency) and 6 (claims branch missing): every later
  // claim would meet the same cause. Neither writes a claim, which dispatch's driver route relies
  // on to skip the claim release (two-call-gate.md §5).
  SHARED_CAUSE: 'shared-cause',
  // 5 (unverified write), or no exit at all (killed or timed out): a claim may have been written.
  UNVERIFIED: 'unverified',
  // Any other exit.
  FAILED: 'failed',
});

const KIND_BY_EXIT = Object.freeze({
  0: CLAIM_KIND.OK,
  2: CLAIM_KIND.SHARED_CAUSE,
  3: CLAIM_KIND.CONTESTED,
  5: CLAIM_KIND.UNVERIFIED,
  6: CLAIM_KIND.SHARED_CAUSE,
  7: CLAIM_KIND.PERMISSION_DENIED,
});

// The claim stop's documented reason (docs/driver.md): `claim-exit-{code}`, or this for no exit.
const NO_EXIT_REASON = 'claim-exit-none';
const REASON_RE = /^claim-exit-(\d+)$/;

// `{ exit, kind, reason }` for a claim-targets.js exit code. `exit` is null when the code is not
// an integer (the CLI was killed or timed out).
function readClaimExit(code) {
  if (!Number.isInteger(code)) return { exit: null, kind: CLAIM_KIND.UNVERIFIED, reason: NO_EXIT_REASON };
  const kind = Object.prototype.hasOwnProperty.call(KIND_BY_EXIT, code) ? KIND_BY_EXIT[code] : CLAIM_KIND.FAILED;
  return { exit: code, kind, reason: `claim-exit-${code}` };
}

// The same object for a stop reason readClaimExit wrote (a process exit code is never negative,
// so a negative one is not read back); null for any other reason (`fail`, a reason of another
// step, a spelling this module never writes).
function readClaimReason(reason) {
  const text = String(reason);
  if (text === NO_EXIT_REASON) return readClaimExit(null);
  const m = REASON_RE.exec(text);
  if (!m) return null;
  const claim = readClaimExit(Number(m[1]));
  return claim.reason === text ? claim : null;
}

module.exports = { CLAIM_KIND, readClaimExit, readClaimReason };
