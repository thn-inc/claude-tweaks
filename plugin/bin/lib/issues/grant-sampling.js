'use strict';
// Sampling floor for the trust ladder (#310) — pure data-in/data-out, same
// shape discipline as fleet-counters.js. Groups (#267) let a trust class
// promote purely on merged-and-unreverted survival signal, with no floor on
// how much real /demo calibration evidence keeps entering the table. This
// module answers one narrow question: given the ordered history of
// machine-granted merged records, which of them land on a sampling
// boundary and should be flagged for a real human /demo verdict.
//
// "Machine-granted" reuses fleet-counters.js's own detection — a grant only
// counts as machine-origin when its audit comment carries the
// `grant-mode-audit:` marker (skills/backlog/refine-headless.md, #269); the
// `auto:merge` label alone is not enough, since a human can grant it too.
const { isMachineGrant } = require('./fleet-counters.js');

// ordinal is 1-based (the ordinal-th machine-granted merge ever observed).
// every <= 0 or non-finite never samples anything, rather than throwing —
// callers pass a resolved policy value that should already be a positive
// integer, but a malformed one must fail closed (nothing flagged), not
// crash a dashboard scan.
function isSampleOrdinal(ordinal, every) {
  const n = Number(every);
  if (!Number.isFinite(n) || n <= 0) return false;
  return Number.isInteger(ordinal) && ordinal > 0 && ordinal % n === 0;
}

// merges: [{ number, closedAtIso, commentBodies }] — every closed record
// that carries the auto:merge grant, whether or not its audit comment marks
// it machine-origin (this function does that filtering itself, the same
// way fleet-counters.js's own `merges` counter leaves the human/machine
// split to isMachineGrant rather than asking the caller to pre-split).
// Sorted ascending by closedAtIso before assigning ordinals, so the result
// is deterministic regardless of the caller's fetch order (gh issue list
// returns newest-first).
//
// Returns [{ number, ordinal }] for every machine-granted merge whose
// position lands on a sampling boundary — the caller is responsible for
// narrowing that down to records still awaiting a verdict (a pending acceptance state)
// before rendering a call to action; this function has no opinion on
// acceptance state, only on ordinal position in the machine-granted-merge
// history.
function sampledForDemo(merges, every) {
  const machineGranted = (Array.isArray(merges) ? merges : [])
    .filter((m) => m && isMachineGrant(m))
    .slice()
    .sort((a, b) => Date.parse(a.closedAtIso || 0) - Date.parse(b.closedAtIso || 0));

  const flagged = [];
  machineGranted.forEach((m, i) => {
    const ordinal = i + 1;
    if (isSampleOrdinal(ordinal, every)) flagged.push({ number: m.number, ordinal });
  });
  return flagged;
}

module.exports = { isSampleOrdinal, sampledForDemo };
