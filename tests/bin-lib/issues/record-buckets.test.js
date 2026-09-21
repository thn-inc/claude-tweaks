// tests/bin-lib/issues/record-buckets.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isBacklog, isParked, isBotBlocked, isBotParked, isBotInProgress, classifyStaleness } = require('../../../plugin/bin/lib/issues/record-buckets');

function makeRecord(overrides = {}) {
  return {
    facets: {
      stage: 'backlog',
      bot: { inProgress: false, blocked: false, parked: false },
      ...overrides,
    },
  };
}

// ── isBacklog ──────────────────────────────────────────────────────────────

test('isBacklog returns true for a backlog-stage record', () => {
  assert.strictEqual(isBacklog(makeRecord({ stage: 'backlog' })), true);
});

test('isBacklog returns false for a non-backlog-stage record', () => {
  assert.strictEqual(isBacklog(makeRecord({ stage: 'ready' })), false);
});

// ── isParked ───────────────────────────────────────────────────────────────

test('isParked returns true for a parked-stage record', () => {
  assert.strictEqual(isParked(makeRecord({ stage: 'parked' })), true);
});

test('isParked returns false for a non-parked-stage record', () => {
  assert.strictEqual(isParked(makeRecord({ stage: 'backlog' })), false);
});

// ── isBotBlocked ─────────────────────────────────────────────────────────────

test('isBotBlocked returns true when facets.bot.blocked is true', () => {
  const record = makeRecord();
  record.facets.bot.blocked = true;
  assert.strictEqual(isBotBlocked(record), true);
});

test('isBotBlocked returns false for the default (false) bot state', () => {
  assert.strictEqual(isBotBlocked(makeRecord()), false);
});

test('isBotBlocked returns false for a local-files-shaped record (facets.bot is always the default object, never absent)', () => {
  // local-store.js's defaultFacets() spreads facet-shape.js's sharedFacetDefaults(), which
  // always includes bot: { inProgress: false, blocked: false, parked: false } — this is the
  // actual shape a brand-new local-files record produces, never an undefined/missing field.
  const localFilesRecord = { facets: { stage: 'backlog', bot: { inProgress: false, blocked: false, parked: false } } };
  assert.strictEqual(isBotBlocked(localFilesRecord), false);
});

// ── isBotParked ──────────────────────────────────────────────────────────────

test('isBotParked returns true when facets.bot.parked is true', () => {
  const record = makeRecord();
  record.facets.bot.parked = true;
  assert.strictEqual(isBotParked(record), true);
});

test('isBotParked returns false for the default (false) bot state', () => {
  assert.strictEqual(isBotParked(makeRecord()), false);
});

test('isBotParked returns false when only bot.blocked is true (the two never overlap)', () => {
  const record = makeRecord();
  record.facets.bot.blocked = true;
  assert.strictEqual(isBotParked(record), false);
  assert.strictEqual(isBotBlocked(record), true);
});

// ── isBotInProgress ──────────────────────────────────────────────────────────

test('isBotInProgress returns true when facets.bot.inProgress is true', () => {
  const record = makeRecord();
  record.facets.bot.inProgress = true;
  assert.strictEqual(isBotInProgress(record), true);
});

test('isBotInProgress returns false for the default (false) bot state', () => {
  assert.strictEqual(isBotInProgress(makeRecord()), false);
});

// ── classifyStaleness ────────────────────────────────────────────────────────

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;

test('age 0 classifies as fresh', () => {
  assert.strictEqual(classifyStaleness(0, FOUR_WEEKS_MS), 'fresh');
});

test('age just under the review-band midpoint (threshold/2) classifies as fresh', () => {
  assert.strictEqual(classifyStaleness(FOUR_WEEKS_MS / 2 - 1, FOUR_WEEKS_MS), 'fresh');
});

test('age exactly at the review-band midpoint (threshold/2) classifies as review', () => {
  assert.strictEqual(classifyStaleness(FOUR_WEEKS_MS / 2, FOUR_WEEKS_MS), 'review');
});

test('age exactly at the threshold classifies as review, not stale', () => {
  assert.strictEqual(classifyStaleness(FOUR_WEEKS_MS, FOUR_WEEKS_MS), 'review');
});

test('age just over the threshold classifies as stale', () => {
  assert.strictEqual(classifyStaleness(FOUR_WEEKS_MS + 1, FOUR_WEEKS_MS), 'stale');
});

test('classifyStaleness scales correctly with a non-default threshold (record-staleness-weeks: 8)', () => {
  const eightWeeksMs = 56 * 24 * 60 * 60 * 1000;
  const fiveWeeksMs = 5 * 7 * 24 * 60 * 60 * 1000;
  const threeWeeksMs = 3 * 7 * 24 * 60 * 60 * 1000;
  assert.strictEqual(classifyStaleness(fiveWeeksMs, eightWeeksMs), 'review');
  assert.strictEqual(classifyStaleness(threeWeeksMs, eightWeeksMs), 'fresh');
});

// ── classifyStaleness: malformed-threshold fallback ──────────────────────────
// Without the guard, every comparison against NaN is false, so execution falls
// straight through to 'stale' for every record — including future-dated ones.

test('a NaN threshold (typo\'d config value) falls back to the 4-week default instead of classifying everything stale', () => {
  assert.strictEqual(classifyStaleness(0, Number('four') * 7 * 24 * 60 * 60 * 1000), 'fresh');
  assert.strictEqual(classifyStaleness(FOUR_WEEKS_MS / 2, NaN), 'review');
  assert.strictEqual(classifyStaleness(FOUR_WEEKS_MS + 1, NaN), 'stale');
});

test('a future-dated record (negative age) is fresh, not stale, under a NaN threshold', () => {
  assert.strictEqual(classifyStaleness(-FOUR_WEEKS_MS, NaN), 'fresh');
});

test('a negative, zero, non-finite, or missing threshold falls back to the 4-week default', () => {
  assert.strictEqual(classifyStaleness(FOUR_WEEKS_MS / 2, -FOUR_WEEKS_MS), 'review');
  assert.strictEqual(classifyStaleness(FOUR_WEEKS_MS / 2, 0), 'review');
  assert.strictEqual(classifyStaleness(FOUR_WEEKS_MS / 2, Infinity), 'review');
  assert.strictEqual(classifyStaleness(FOUR_WEEKS_MS / 2, undefined), 'review');
});
