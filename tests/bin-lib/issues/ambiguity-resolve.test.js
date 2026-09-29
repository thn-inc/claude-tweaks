// tests/bin-lib/issues/ambiguity-resolve.test.js — unit coverage for
// bin/lib/issues/ambiguity-resolve.js's pure body-transform functions (#2699).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  countAmbiguityMarkers,
  hasOpenQuestionsSection,
  readyRestorable,
  resolveAmbiguityMarker,
} = require('../../../plugin/bin/lib/issues/ambiguity-resolve');

// --- countAmbiguityMarkers -------------------------------------------------

test('countAmbiguityMarkers: zero on a body with none', () => {
  assert.equal(countAmbiguityMarkers('## Deliverables\n\nDo the thing.'), 0);
});

test('countAmbiguityMarkers: counts multiple markers', () => {
  const body = 'A <!-- ambiguity: which store? --> and B <!-- ambiguity: sync or async? -->.';
  assert.equal(countAmbiguityMarkers(body), 2);
});

test('countAmbiguityMarkers: non-string input is zero, never throws', () => {
  assert.equal(countAmbiguityMarkers(undefined), 0);
  assert.equal(countAmbiguityMarkers(null), 0);
});

// --- hasOpenQuestionsSection ------------------------------------------------

test('hasOpenQuestionsSection: false when absent', () => {
  assert.equal(hasOpenQuestionsSection('## Deliverables\n\nDo the thing.'), false);
});

test('hasOpenQuestionsSection: true when the heading survives, any level 2-4', () => {
  assert.equal(hasOpenQuestionsSection('## Open Questions\n\n| Persona | Finding |\n'), true);
  assert.equal(hasOpenQuestionsSection('#### Open Questions\nrow'), true);
});

test('hasOpenQuestionsSection: a heading-level mismatch (h1, h5+) does not match', () => {
  assert.equal(hasOpenQuestionsSection('# Open Questions\nrow'), false);
  assert.equal(hasOpenQuestionsSection('###### Open Questions\nrow'), false);
});

// --- readyRestorable ---------------------------------------------------------

test('readyRestorable: true when both are clear', () => {
  assert.equal(readyRestorable('## Deliverables\n\nAll clear.'), true);
});

test('readyRestorable: false with a remaining marker', () => {
  assert.equal(readyRestorable('<!-- ambiguity: still open -->'), false);
});

test('readyRestorable: false with a surviving Open Questions heading, even with zero markers', () => {
  assert.equal(readyRestorable('## Open Questions\n\n| P | F |\n'), false);
});

// --- resolveAmbiguityMarker ---------------------------------------------------

test('resolveAmbiguityMarker: replaces the first verbatim occurrence', () => {
  const body = 'Before. <!-- ambiguity: which store? --> After.';
  const result = resolveAmbiguityMarker(body, '<!-- ambiguity: which store? -->', 'Uses Redis (decided at #123).');
  assert.equal(result.body, 'Before. Uses Redis (decided at #123). After.');
  assert.equal(result.markersRemaining, 0);
  assert.equal(result.openQuestionsRemaining, false);
  assert.equal(result.readyRestorable, true);
});

test('resolveAmbiguityMarker: only the FIRST occurrence is replaced when the marker text repeats', () => {
  const body = 'X <!-- ambiguity: dup --> Y <!-- ambiguity: dup -->';
  const result = resolveAmbiguityMarker(body, '<!-- ambiguity: dup -->', 'resolved');
  assert.equal(result.body, 'X resolved Y <!-- ambiguity: dup -->');
  assert.equal(result.markersRemaining, 1);
  assert.equal(result.readyRestorable, false);
});

test('resolveAmbiguityMarker: readyRestorable stays false when another marker remains', () => {
  const body = '<!-- ambiguity: a --> and <!-- ambiguity: b -->';
  const result = resolveAmbiguityMarker(body, '<!-- ambiguity: a -->', 'resolved a');
  assert.equal(result.markersRemaining, 1);
  assert.equal(result.readyRestorable, false);
});

test('resolveAmbiguityMarker: readyRestorable stays false when an Open Questions section survives', () => {
  const body = '<!-- ambiguity: a -->\n\n## Open Questions\n\n| Persona | Finding |\n|---|---|\n| Maintainer | x |\n';
  const result = resolveAmbiguityMarker(body, '<!-- ambiguity: a -->', 'resolved');
  assert.equal(result.markersRemaining, 0);
  assert.equal(result.openQuestionsRemaining, true);
  assert.equal(result.readyRestorable, false);
});

test('resolveAmbiguityMarker: matching against the flagged sentence instead of the marker itself', () => {
  const body = 'The sync mode is undecided pending review. Rest of body.';
  const result = resolveAmbiguityMarker(body, 'The sync mode is undecided pending review.', 'Sync mode is async, per #45.');
  assert.equal(result.body, 'Sync mode is async, per #45. Rest of body.');
  assert.equal(result.readyRestorable, true);
});

test('resolveAmbiguityMarker: throws when markerText is not found verbatim — no partial edit', () => {
  const body = 'Nothing to see here.';
  assert.throws(
    () => resolveAmbiguityMarker(body, '<!-- ambiguity: missing -->', 'x'),
    /markerText not found verbatim/,
  );
});

test('resolveAmbiguityMarker: rejects a non-string body', () => {
  assert.throws(() => resolveAmbiguityMarker(null, 'x', 'y'), /body must be a string/);
});

test('resolveAmbiguityMarker: rejects an empty markerText', () => {
  assert.throws(() => resolveAmbiguityMarker('body', '', 'y'), /markerText must be a non-empty string/);
});

test('resolveAmbiguityMarker: rejects a non-string resolutionText', () => {
  assert.throws(() => resolveAmbiguityMarker('body', 'body', null), /resolutionText must be a string/);
});
