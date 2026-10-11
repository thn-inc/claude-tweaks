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

// A body that passes the spec-shaped gate; `extra` lands in Deliverables.
const shaped = (extra = '', tail = '') => [
  '## Current State', 'Things are as they are.', '',
  '## Deliverables', `- [ ] Do the thing. ${extra}`.trimEnd(), '',
  '## Acceptance Criteria', '- [ ] The thing is done.', '',
  '## Release Note', 'Did the thing.', tail,
].join('\n');

const OPEN_QUESTIONS = '\n## Open Questions\n\n| Persona | Finding | Suggested Resolution |\n|---------|---------|---------------------|\n| Maintainer | Which store? | Redis |\n';

// --- countAmbiguityMarkers -------------------------------------------------

test('countAmbiguityMarkers: zero on a body with none', () => {
  assert.equal(countAmbiguityMarkers(shaped()), 0);
});

test('countAmbiguityMarkers: counts multiple markers', () => {
  assert.equal(countAmbiguityMarkers('A <!-- ambiguity: which store? --> and B <!-- ambiguity: sync? -->.'), 2);
});

test('countAmbiguityMarkers: counts a marker whose comment spans lines', () => {
  assert.equal(countAmbiguityMarkers('A\n<!-- ambiguity: Skeptical Reviewer — a long\nfinding; suggested: x -->\n'), 1);
});

test('countAmbiguityMarkers: counts an unterminated marker, like the spec-shaped gate', () => {
  assert.equal(countAmbiguityMarkers('A <!-- ambiguity: cut off'), 1);
});

test('countAmbiguityMarkers: ignores a marker quoted in a code span or inherited in the original request', () => {
  const body = `${shaped('Never leave a `<!-- ambiguity: -->` marker.')}\n\n## Original request\n\nold <!-- ambiguity: x -->`;
  assert.equal(countAmbiguityMarkers(body), 0);
});

test('countAmbiguityMarkers: non-string input is zero, never throws', () => {
  assert.equal(countAmbiguityMarkers(undefined), 0);
  assert.equal(countAmbiguityMarkers(null), 0);
});

// --- hasOpenQuestionsSection ------------------------------------------------

test('hasOpenQuestionsSection: false when absent', () => {
  assert.equal(hasOpenQuestionsSection(shaped()), false);
});

test('hasOpenQuestionsSection: true when the heading survives, any level 2-4', () => {
  assert.equal(hasOpenQuestionsSection('## Open Questions\n\n| Persona | Finding |\n'), true);
  assert.equal(hasOpenQuestionsSection('#### Open Questions\nrow'), true);
});

test('hasOpenQuestionsSection: matches the template\'s "(optional)" heading and other casings', () => {
  assert.equal(hasOpenQuestionsSection('## Open Questions (optional)\n| a |'), true);
  assert.equal(hasOpenQuestionsSection('## Open questions\n| a |'), true);
});

test('hasOpenQuestionsSection: a heading-level mismatch (h1, h5+) does not match', () => {
  assert.equal(hasOpenQuestionsSection('# Open Questions\nrow'), false);
  assert.equal(hasOpenQuestionsSection('###### Open Questions\nrow'), false);
});

// --- readyRestorable ---------------------------------------------------------

test('readyRestorable: true for a spec-shaped body with no marker and no Open Questions', () => {
  assert.equal(readyRestorable(shaped()), true);
});

test('readyRestorable: false with a remaining marker', () => {
  assert.equal(readyRestorable(shaped('<!-- ambiguity: still open -->')), false);
});

test('readyRestorable: false with a surviving Open Questions section, even with zero markers', () => {
  assert.equal(readyRestorable(shaped('', OPEN_QUESTIONS)), false);
});

test('readyRestorable: false when the body fails the spec-shaped gate for another reason (TBD, missing section)', () => {
  assert.equal(readyRestorable(shaped('TBD')), false);
  assert.equal(readyRestorable('## Deliverables\n\nAll clear.'), false);
});

test('readyRestorable: true when the only marker left is quoted in a code span', () => {
  assert.equal(readyRestorable(shaped('Never leave a `<!-- ambiguity: -->` marker.')), true);
});

// --- resolveAmbiguityMarker ---------------------------------------------------

test('resolveAmbiguityMarker: replaces the marker and reports ready restorable', () => {
  const body = shaped('<!-- ambiguity: which store? -->');
  const result = resolveAmbiguityMarker(body, '<!-- ambiguity: which store? -->', 'Uses Redis (decided at #123).');
  assert.equal(result.body, shaped('Uses Redis (decided at #123).'));
  assert.equal(result.markersRemaining, 0);
  assert.equal(result.openQuestionsRemaining, false);
  assert.equal(result.readyRestorable, true);
});

test('resolveAmbiguityMarker: resolves a marker whose comment spans lines', () => {
  const marker = '<!-- ambiguity: Skeptical Reviewer — a long\nfinding; suggested: x -->';
  const result = resolveAmbiguityMarker(shaped(marker), marker, 'Settled: x.');
  assert.equal(result.body, shaped('Settled: x.'));
  assert.equal(result.readyRestorable, true);
});

test('resolveAmbiguityMarker: readyRestorable stays false when another marker remains', () => {
  const result = resolveAmbiguityMarker(shaped('<!-- ambiguity: a --> <!-- ambiguity: b -->'), '<!-- ambiguity: a -->', 'resolved a');
  assert.equal(result.markersRemaining, 1);
  assert.equal(result.readyRestorable, false);
});

test('resolveAmbiguityMarker: readyRestorable stays false while an Open Questions row remains', () => {
  const result = resolveAmbiguityMarker(shaped('<!-- ambiguity: a -->', OPEN_QUESTIONS), '<!-- ambiguity: a -->', 'resolved');
  assert.equal(result.markersRemaining, 0);
  assert.equal(result.openQuestionsRemaining, true);
  assert.equal(result.readyRestorable, false);
});

test('resolveAmbiguityMarker: deleting the last Open Questions row removes the section and restores ready', () => {
  const result = resolveAmbiguityMarker(shaped('', OPEN_QUESTIONS), '| Maintainer | Which store? | Redis |', '');
  assert.equal(result.openQuestionsRemoved, true);
  assert.equal(result.openQuestionsRemaining, false);
  assert.equal(result.readyRestorable, true);
  assert.doesNotMatch(result.body, /Open Questions/);
});

test('resolveAmbiguityMarker: deleting one of two rows keeps the table contiguous and the section in place', () => {
  const twoRows = `${OPEN_QUESTIONS}| Implementer | Sync or async? | async |\n`;
  const result = resolveAmbiguityMarker(shaped('', twoRows), '| Maintainer | Which store? | Redis |', '');
  assert.equal(result.openQuestionsRemoved, false);
  assert.equal(result.readyRestorable, false);
  assert.match(result.body, /\|---------------------\|\n\| Implementer \| Sync or async\? \| async \|/);
});

test('resolveAmbiguityMarker: refuses text that occurs more than once (AMBIGUOUS) rather than editing the first hit', () => {
  const body = 'See X. Later: X. <!-- ambiguity: p -->';
  assert.throws(() => resolveAmbiguityMarker(body, 'X.', 'Y.'), (err) => err.code === 'AMBIGUOUS');
});

test('resolveAmbiguityMarker: throws NOT_FOUND when the text is absent', () => {
  assert.throws(
    () => resolveAmbiguityMarker('Nothing to see here.', '<!-- ambiguity: missing -->', 'x'),
    (err) => err.code === 'NOT_FOUND',
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
