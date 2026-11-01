// The one implementation of `tidy/scan-procedures.md` Step 4's Plan retention
// arithmetic (#4594): which plans delete, keep, prune-ask, or prune-archive,
// and when the citation check and the decline lookup are needed. Pure — the
// caller supplies today's date, the citation result, and the decline lookup.
//
// Boundary decision: a plan is past the cutoff when its first-add calendar date
// is 7 or more days before today (`ageInDays >= 7`); 6 days is within, and a
// first-add date after today is within. Dates are compared as calendar days,
// never timestamps, so the time of day cannot move a plan across the line.
'use strict';

const CUTOFF_DAYS = 7;
const ARCHIVE_THRESHOLD = 30;
const UNCOMMITTED = 'uncommitted';
const RETENTION_VALUES = Object.freeze(['keep-forever', 'prune-after-wrapup', 'ask']);

const MS_PER_DAY = 86400000;

function utcDay(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// Calendar-day difference; negative when `firstAdded` is after `today`.
function ageInDays(firstAdded, today) {
  return (utcDay(today) - utcDay(firstAdded)) / MS_PER_DAY;
}

function isPastCutoff(firstAdded, today) {
  if (firstAdded === UNCOMMITTED) return false;
  return ageInDays(firstAdded, today) >= CUTOFF_DAYS;
}

// `cited` is the two-pass input (keep-forever only): `null` on the first pass, a Set of plans the model-judged
// citation check found cited on the second. `citationCheck` in the result means "the caller owes that check"
// and is retention-dependent: under keep-forever it is true on the first pass only, and the first pass's
// `prune-archive` routes are provisional until the second pass recounts with the cited set; under `ask` and
// `prune-after-wrapup` the returned routes are final (`cited` is never consulted) and `citationCheck: true`
// tells the caller to apply the check's outcome directly, with no second pass.
function routePlans({ retention, plans, today, cited, lookupDecline }) {
  if (!RETENTION_VALUES.includes(retention)) {
    throw new Error(`unknown retention value: ${retention}`);
  }

  const rows = plans.map(({ plan, firstAdded }) => ({
    plan,
    firstAdded,
    pastCutoff: isPastCutoff(firstAdded, today),
    cited: cited !== null && cited.has(plan),
    route: 'keep',
  }));
  const result = (citationCheck, citationCandidates, decline) => ({
    citationCheck, citationCandidates, decline, plans: rows,
  });

  if (retention === 'prune-after-wrapup') {
    rows.forEach((row) => { row.route = 'delete'; });
    return result(rows.length > 0, rows.map((row) => row.plan), null);
  }

  if (retention === 'ask') {
    const candidates = rows.filter((row) => row.firstAdded !== UNCOMMITTED);
    candidates.forEach((row) => { row.route = 'prune-ask'; });
    return result(candidates.length > 0, candidates.map((row) => row.plan), null);
  }

  // keep-forever: plans past the cutoff that no citation protects.
  const uncited = rows.filter((row) => row.pastCutoff && !row.cited);
  if (uncited.length < ARCHIVE_THRESHOLD) return result(false, [], null);

  // The citation check is requested once the pre-check count reaches the
  // threshold, before and regardless of the decline lookup: a cited candidate
  // must still render per `plan-citation-check.md` while a decline is live, so
  // running the lookup first and skipping the check would change what the
  // caller shows. The lookup itself is a thunk so it runs only here, at 30 or
  // more uncited plans, and the fail-closed handling below lives in one place.
  const firstPass = cited === null;
  const citationCandidates = firstPass ? uncited.map((row) => row.plan) : [];

  let decline;
  try {
    decline = { live: lookupDecline() != null, error: null };
  } catch (err) {
    decline = { live: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Fail closed: a live decline or a lookup that throws keeps every plan. The
  // production store never throws (a missing or corrupt store reads as no
  // decline, an accepted degrade-open), so the throw arm guards the injected
  // seam.
  if (!decline.live && decline.error === null) {
    uncited.forEach((row) => { row.route = 'prune-archive'; });
  }
  return result(firstPass, citationCandidates, decline);
}

module.exports = {
  CUTOFF_DAYS, ARCHIVE_THRESHOLD, UNCOMMITTED, RETENTION_VALUES,
  ageInDays, isPastCutoff, routePlans,
};
