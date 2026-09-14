// bin/lib/issues/record-buckets.js
// Pure: the record-stage/bot-state predicates and staleness classifier
// duplicated independently in /help's status-scan.md and /tidy's
// scan-procedures.md before this module existed. facets.stage and
// facets.bot are always present on both drivers (facet-shape.js's
// sharedFacetDefaults(), spread into both record.js's parseRecordFacets
// and local-store.js's defaultFacets) — no optional chaining needed here.
'use strict';

function isBacklog(record) {
  return record.facets.stage === 'backlog';
}

function isParked(record) {
  return record.facets.stage === 'parked';
}

function isBotBlocked(record) {
  return record.facets.bot.blocked === true;
}

function isBotParked(record) {
  return record.facets.bot.parked === true;
}

function isBotInProgress(record) {
  return record.facets.bot.inProgress === true;
}

const DEFAULT_THRESHOLD_MS = 28 * 24 * 60 * 60 * 1000; // record-staleness-weeks default: 4 weeks

// Bands: fresh below half the threshold, review from half up to and including
// the threshold, stale beyond it. Preserves the original fixed 2-week/4-week
// ratio (half of 4 weeks = 2 weeks) as the threshold scales with project policy.
//
// A malformed thresholdMs (NaN from a typo'd config value, zero, negative,
// Infinity) falls back to the 4-week default rather than propagating: every
// comparison against NaN is false, so an unguarded NaN would silently classify
// every record — including future-dated ones — as stale.
function classifyStaleness(ageMs, thresholdMs) {
  const threshold = Number.isFinite(thresholdMs) && thresholdMs > 0 ? thresholdMs : DEFAULT_THRESHOLD_MS;
  const half = threshold / 2;
  if (ageMs < half) return 'fresh';
  if (ageMs <= threshold) return 'review';
  return 'stale';
}

module.exports = { isBacklog, isParked, isBotBlocked, isBotParked, isBotInProgress, classifyStaleness };
