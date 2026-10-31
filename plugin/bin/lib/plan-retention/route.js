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
  // threshold, before and regardless of the decline lookup.
  const firstPass = cited === null;
  const citationCandidates = firstPass ? uncited.map((row) => row.plan) : [];

  let decline;
  try {
    decline = { live: lookupDecline() != null, error: null };
  } catch (err) {
    decline = { live: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Fail closed: a live decline or a lookup that throws keeps every plan.
  if (!decline.live && decline.error === null) {
    uncited.forEach((row) => { row.route = 'prune-archive'; });
  }
  return result(firstPass, citationCandidates, decline);
}

module.exports = {
  CUTOFF_DAYS, ARCHIVE_THRESHOLD, UNCOMMITTED, RETENTION_VALUES,
  ageInDays, isPastCutoff, routePlans,
};
