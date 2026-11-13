'use strict';
// Admission for the pipeline driver lane: whether one record may enter the
// driver's run loop (#5216, from the pipeline driver design's "Eligibility"
// section), as one pure verdict.
// No I/O: the caller fetches the record's state, labels, open blockers and open
// linked PRs, and resolves the `express-driver` routing value, then passes them in.
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
// Every gate runs on every call, so one verdict names every reason that applies.

const { normalizeLabelNames, parseRecordFacets, LABELS } = require('../issues/record');

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
});

const R = ADMISSION_REASONS;

// `express-driver` routing -> the reason it refuses this record, or null. Only
// `split` reads the issue number: an even number is admitted, an odd one refused,
// and a missing or non-integer one is unreadable. `split` exists to compare the
// driver with the standard path on similar records: the odd half stays on the
// other paths. It is temporary, dropped for `on` or `off` once each arm has 20
// merged records (#5216; the `express-driver` row of _shared/policy-schema.md).
function routingReason(routing, number) {
  if (routing === 'on') return null;
  if (routing === 'off') return R.routingOff;
  if (routing === 'split') {
    if (!Number.isInteger(number)) return R.splitUnreadable;
    return number % 2 === 0 ? null : R.splitOdd;
  }
  return R.routingUnknown(routing);
}

// { number, state, labels, openBlockerRefs, openLinkedPRs, routing, driverEscalated } -> { admitted, reasons }.
function evaluateAdmission(facts) {
  // A null or non-object argument reads as no facts at all: every unreadable reason fires.
  const { number, state, labels, openBlockerRefs, openLinkedPRs, routing, driverEscalated } =
    (facts && typeof facts === 'object') ? facts : {};
  const reasons = [];

  // normalizeLabelNames throws on a string or plain object, so an unreadable
  // label list is refused before any parse and the three label gates are skipped.
  if (!Array.isArray(labels)) {
    reasons.push(R.labelsUnreadable);
  } else {
    const names = normalizeLabelNames(labels);
    const facets = parseRecordFacets(labels);
    if (!facets.grants.build) reasons.push(R.noBuildGrant);
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

  return { admitted: reasons.length === 0, reasons };
}

module.exports = { ADMISSION_REASONS, evaluateAdmission };
