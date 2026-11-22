'use strict';
// Admission for the pipeline driver lane: whether one record may enter the
// driver's run loop (#5216, from the pipeline driver design's "Eligibility"
// section), as one pure verdict.
// No I/O: the caller fetches the record's state, labels, open blockers, open
// linked PRs and whether a trusted driver-escalation marker is on it, and resolves the
// `express-driver` routing value, then passes them in.
//
// The closed rule. The refusals in ADMISSION_REASONS are the complete set; adding
// a refusal is the only amendment this rule may take. A claimed record
// (`bot:in-progress`) is deliberately not a gate here: the claim step owns it.
//
// Blocker and open-PR state are never decided here. `openBlockerRefs` is the
// shared predicates' output (`partitionByOpenBodyBlockers` /
// `openNativeBlockerRefs` in ../issues/record-dependencies.js, where only an exact
// CLOSED releases a blocker), and `openLinkedPRs` is `partitionByOpenLinkedPR`'s.
// A non-empty array refuses; a value that is not an array is unreadable and
// refuses with its own reason, never read as "none".
//
// `driverEscalated` is the driver's own escalation marker read off the record's
// comments (`hasDriverEscalationMarker` in ./settle.js, which owns the trusted-author
// check): true refuses, false passes, and anything that is not a boolean (null for an
// unreadable comment list) refuses as unreadable, never read as "not escalated".
//
// The reviewer rule (#5224). A record is beyond the express bounds when its size label is not
// `low` or it has more than EXPRESS_MAX_KEY_FILES Key Files (eligibility.js's isBeyondExpressBounds,
// which review.js's reviewRequired shares), and inside the driver's bounds when
// its size is one `bounds.sizeCeiling` accepts (SIZE_CEILINGS) and it has at most
// `bounds.maxKeyFiles` Key Files (eligibility.js's isInsideLaneBounds, built from the same two
// comparisons eligibility refuses on). `keyFiles` is the eligibility verdict's own extraction and
// `reviewerOn` is review.js's reviewRequired answer, computed once per record by the caller.
// Its states, and no others:
//   beyond the express bounds and the reviewer on      admitted by this rule
//   beyond the express bounds and the reviewer not on  refused, reviewerOff
//   inside the express bounds                          the rule does not apply
// A widened record (#6018, #6019) is one the caller admitted above low risk, with a non-fast-lane ceremony or
// with a protected Key File;
// `widenedBy` is eligibility.js's widenings() answer, computed by the caller (absent reads as none):
//   widened and the reviewer on                        admitted by this rule
//   widened and the reviewer not on                    refused, reviewerOffWidened
//   `widenedBy` not an array of strings                refused, widenedUnreadable
// The widened rule checks no bounds. isReadableWidenedBy is its one readability test, shared with
// review.js's reviewRequired; widenedReviewerReason is the rule alone, for queue.js's driver half.
// A record beyond the driver's bounds adds nothing to this express-bounds rule: eligibility owns that refusal. A
// `reviewerOn` that is not a boolean, unreadable bounds (not an object, a ceiling that is not a
// SIZE_CEILINGS key, a limit that is not a safe integer of at least 1) and a `keyFiles` that is
// not an array each refuse with their own reason, never read as "off" or "none".
// reviewerGateReason is the rule alone, for the eligibility step to append to a refusal.
//
// Every gate runs on every call, so one verdict names every reason that applies.

const { normalizeLabelNames, parseRecordFacets, LABELS } = require('../issues/record');
const {
  isBeyondExpressBounds, isInsideLaneBounds, isReadableSizeCeiling, isReadableKeyFileLimit,
} = require('../express/eligibility');

const ADMISSION_REASONS = Object.freeze({
  noBuildGrant: 'record lacks auto:build',
  parked: 'record is parked',
  blocked: 'record is blocked',
  openBlocker: 'record has an open blocker',
  openPR: 'record has an open PR',
  notOpen: 'record is not open',
  blockerFactsUnreadable: 'blocker facts unreadable',
  prFactsUnreadable: 'open PR facts unreadable',
  stateUnreadable: 'record state unreadable',
  labelsUnreadable: 'record labels unreadable',
  routingOff: 'express-driver is off',
  splitOdd: 'express-driver split: issue number is odd',
  splitUnreadable: 'express-driver split: issue number unreadable',
  escalatedByDriver: 'already escalated by the driver',
  commentsUnreadable: 'record comments unreadable',
  routingUnknown: (value) => `express-driver value not recognised: ${value}`,
  reviewerOff: 'record is beyond the express bounds and the reviewer step is off for it',
  reviewerOffWidened: 'record is admitted widened (above low risk, with a non-fast-lane ceremony or a protected Key File) and the reviewer step is off for it',
  reviewerUnreadable: 'reviewer-on answer unreadable',
  widenedUnreadable: 'record widening facts unreadable',
  boundsUnreadable: 'lane bounds unreadable',
  keyFilesUnreadable: 'record Key Files unreadable',
});

const R = ADMISSION_REASONS;

// `express-driver` routing -> the reason it refuses this record, or null. Only
// `split` reads the issue number: an even number is admitted, an odd one refused,
// and a missing or non-integer one is unreadable. `split` exists to compare the
// driver with the standard path on similar records: the odd half stays on the
// other paths. It is temporary, dropped for `on` or `off` once each arm has 20
// merged records (#5216; the `express-driver` row of _shared/policy-schema-express-driver.md).
function routingReason(routing, number) {
  if (routing === 'on') return null;
  if (routing === 'off') return R.routingOff;
  if (routing === 'split') {
    if (!Number.isInteger(number)) return R.splitUnreadable;
    return number % 2 === 0 ? null : R.splitOdd;
  }
  return R.routingUnknown(routing);
}

// The checks eligibility applies to the same two values.
function boundsReadable(bounds) {
  if (!bounds || typeof bounds !== 'object') return false;
  return isReadableSizeCeiling(bounds.sizeCeiling) && isReadableKeyFileLimit(bounds.maxKeyFiles);
}

// { labels, keyFiles, bounds, reviewerOn } -> R.reviewerOff, or null (the rule does not refuse,
// or an input is unreadable: those reasons are evaluateAdmission's).
function reviewerGateReason(facts) {
  const { labels, keyFiles, bounds, reviewerOn } = (facts && typeof facts === 'object') ? facts : {};
  if (!Array.isArray(labels) || !Array.isArray(keyFiles) || !boundsReadable(bounds)) return null;
  const { size } = parseRecordFacets(labels);
  const beyond = isBeyondExpressBounds({ size, keyFiles });
  const inside = isInsideLaneBounds({ size, keyFiles, bounds });
  return beyond && inside && reviewerOn === false ? R.reviewerOff : null;
}

// widenedBy as the caller passes it: absent reads as none (a caller from before #6018); otherwise an
// array whose elements are all strings.
function isReadableWidenedBy(widenedBy) {
  return widenedBy === undefined || (Array.isArray(widenedBy) && widenedBy.every((w) => typeof w === 'string'));
}

// { widenedBy, reviewerOn } -> R.widenedUnreadable, R.reviewerOffWidened, or null.
function widenedReviewerReason(facts) {
  const { widenedBy, reviewerOn } = (facts && typeof facts === 'object') ? facts : {};
  if (!isReadableWidenedBy(widenedBy)) return R.widenedUnreadable;
  return widenedBy !== undefined && widenedBy.length > 0 && reviewerOn === false ? R.reviewerOffWidened : null;
}

// { number, state, labels, openBlockerRefs, openLinkedPRs, routing, driverEscalated, keyFiles,
//   bounds: { sizeCeiling, maxKeyFiles }, reviewerOn, buildAuthority, widenedBy } -> { admitted, reasons }.
// `buildAuthority` is build-authority.js's resolveBuildAuthority answer (#5584): exactly 'typed'
// lifts the grant gate alone, so a record named by a typed command needs no `auto:build`; any
// other value, or none, leaves the gate as it was. Every other gate still runs.
function evaluateAdmission(facts) {
  // A null or non-object argument reads as no facts at all: every unreadable reason fires.
  const { number, state, labels, openBlockerRefs, openLinkedPRs, routing, driverEscalated, keyFiles, bounds, reviewerOn, buildAuthority, widenedBy } =
    (facts && typeof facts === 'object') ? facts : {};
  const reasons = [];

  // normalizeLabelNames throws on a string or plain object, so an unreadable
  // label list is refused before any parse and the three label gates are skipped.
  if (!Array.isArray(labels)) {
    reasons.push(R.labelsUnreadable);
  } else {
    const names = normalizeLabelNames(labels);
    const facets = parseRecordFacets(labels);
    if (!facets.grants.build && buildAuthority !== 'typed') reasons.push(R.noBuildGrant);
    // Raw label, not facets.stage: stage resolves ready > parked, so a record
    // carrying both would read as ready.
    if (names.includes(LABELS.PARKED) || facets.bot.parked) reasons.push(R.parked);
    if (facets.bot.blocked) reasons.push(R.blocked);
  }

  if (!Array.isArray(openBlockerRefs)) reasons.push(R.blockerFactsUnreadable);
  else if (openBlockerRefs.length > 0) reasons.push(R.openBlocker);

  if (!Array.isArray(openLinkedPRs)) reasons.push(R.prFactsUnreadable);
  else if (openLinkedPRs.length > 0) reasons.push(R.openPR);

  if (typeof state !== 'string') reasons.push(R.stateUnreadable);
  else if (state !== 'OPEN') reasons.push(R.notOpen);

  if (driverEscalated === true) reasons.push(R.escalatedByDriver);
  else if (driverEscalated !== false) reasons.push(R.commentsUnreadable);

  const routed = routingReason(routing, number);
  if (routed) reasons.push(routed);

  if (typeof reviewerOn !== 'boolean') reasons.push(R.reviewerUnreadable);
  if (!boundsReadable(bounds)) reasons.push(R.boundsUnreadable);
  if (!Array.isArray(keyFiles)) reasons.push(R.keyFilesUnreadable);
  const reviewer = reviewerGateReason({ labels, keyFiles, bounds, reviewerOn });
  if (reviewer) reasons.push(reviewer);
  const widenedReason = widenedReviewerReason({ widenedBy, reviewerOn });
  if (widenedReason) reasons.push(widenedReason);

  return { admitted: reasons.length === 0, reasons };
}

module.exports = { ADMISSION_REASONS, evaluateAdmission, reviewerGateReason, routingReason, isReadableWidenedBy, widenedReviewerReason };
