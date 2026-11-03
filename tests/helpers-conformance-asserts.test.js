// tests/helpers-conformance-asserts.test.js — #4827: pins tests/helpers/conformance-asserts.js, the
// fact-list predicate and go-red proofs the prose-conformance suites share.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { missingFactsOf, assertEachPatternGoesRed, assertEveryMatchGoesRed, globalOf, lineStartingWith, sectionOf } = require('./helpers/conformance-asserts');

const FACTS = [[/alpha/, 'has alpha'], [/beta/, 'has beta']];
const missing = missingFactsOf(FACTS);

test('missingFactsOf reports the facts whose pattern no longer matches, in list order', () => {
  assert.deepEqual(missing('alpha beta'), []);
  assert.deepEqual(missing('alpha'), ['has beta']);
  assert.deepEqual(missing(''), ['has alpha', 'has beta']);
});

test('assertEachPatternGoesRed passes when each pattern matches once', () => {
  assertEachPatternGoesRed('alpha beta', FACTS, missing);
});

test('assertEachPatternGoesRed fails on a phrase stated twice: the first-match strip leaves a copy', () => {
  assert.throws(() => assertEachPatternGoesRed('alpha alpha beta', FACTS, missing), /removing only "has alpha"/);
});

test('assertEveryMatchGoesRed passes on a phrase stated twice: it strips every match', () => {
  assertEveryMatchGoesRed('alpha alpha beta', FACTS, missing);
});

test('both proofs fail when an anchor is absent, naming the fact', () => {
  const absentFirst = [[/beta/, 'has beta'], [/alpha/, 'has alpha']];
  const missingAbsentFirst = missingFactsOf(absentFirst);
  assert.throws(() => assertEachPatternGoesRed('alpha', absentFirst, missingAbsentFirst), /anchor text for "has beta" not found/);
  assert.throws(() => assertEveryMatchGoesRed('alpha', absentFirst, missingAbsentFirst), /anchor text for "has beta" not found/);
});

test('both proofs fail when one strip also breaks a neighbouring pattern', () => {
  const overlapping = [[/alpha beta/, 'the pair'], [/beta/, 'has beta']];
  const missingOverlap = missingFactsOf(overlapping);
  assert.throws(() => assertEachPatternGoesRed('alpha beta', overlapping, missingOverlap), /removing only "the pair"/);
  assert.throws(() => assertEveryMatchGoesRed('alpha beta', overlapping, missingOverlap), /removing only "the pair"/);
});

test('both proofs fail on an empty fact list instead of passing with nothing checked', () => {
  assert.throws(() => assertEachPatternGoesRed('alpha beta', [], missingFactsOf([])), /fact list is empty/);
  assert.throws(() => assertEveryMatchGoesRed('alpha beta', [], missingFactsOf([])), /fact list is empty/);
});

test('globalOf adds the g flag once and keeps the other flags', () => {
  assert.equal(globalOf(/a/i).flags, 'gi');
  assert.equal(globalOf(/a/g).flags, 'g');
});

test('lineStartingWith returns the whole first matching line, or the empty string', () => {
  assert.equal(lineStartingWith('one\ntwo words\ntwo more', 'two'), 'two words');
  assert.equal(lineStartingWith('one', 'two'), '');
  assert.equal(lineStartingWith('x two\ntwo words', 'two'), 'two words');
});

const DOC = 'intro\n## First\nbody one\n### Sub\nsub body\n## First Extended\nbody two\n## Last\nbody three\n';

test('sectionOf returns the heading through the text before the next ## heading', () => {
  assert.equal(sectionOf(DOC, '## First'), '## First\nbody one\n### Sub\nsub body');
});

test('sectionOf runs to the end of the text for the last section', () => {
  assert.equal(sectionOf(DOC, '## Last'), '## Last\nbody three\n');
});

test('sectionOf finds a heading on the text\'s first line', () => {
  assert.equal(sectionOf('## First\nbody one\n## Next\nbody two\n', '## First'), '## First\nbody one');
});

test('sectionOf finds a heading on the last line with no trailing newline, and a heading that is the whole text', () => {
  assert.equal(sectionOf('intro\n## Last', '## Last'), '## Last');
  assert.equal(sectionOf('## Only', '## Only'), '## Only');
});

test('sectionOf matches the whole heading line, never a prefix or a deeper heading', () => {
  assert.throws(() => sectionOf(DOC, '## Sub'), /heading not found: ## Sub/);
  assert.throws(() => sectionOf(DOC, '## Fir'), /heading not found: ## Fir/);
  assert.throws(() => sectionOf(DOC, '## Absent'), /heading not found: ## Absent/);
});

test('sectionOf names the document it searched when the heading is missing', () => {
  assert.throws(() => sectionOf(DOC, '## Absent'), /text opens "intro"/);
});
