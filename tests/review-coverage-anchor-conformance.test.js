// tests/review-coverage-anchor-conformance.test.js — pins #3049: review Step 3's lens
// dispatch prompt includes a rule that coverage gaps anchor at the production line under
// test, while test-quality defects anchor at the test line itself.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (...p) => fs.readFileSync(path.join(SKILLS, ...p), 'utf8');

// Slice between two anchors, asserting both resolve — a missing end anchor would otherwise
// make slice(start, -1) silently widen the region to the rest of the file.
function between(text, startAnchor, endAnchor) {
  const start = text.indexOf(startAnchor);
  assert.notEqual(start, -1, `missing start anchor: ${startAnchor}`);
  const end = text.indexOf(endAnchor, start);
  assert.notEqual(end, -1, `missing end anchor: ${endAnchor}`);
  return text.slice(start, end);
}

test('the coverage-finding anchor rule exists in step3-lens-dispatch.md', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  assert.match(d, /> \*\*Coverage findings anchor at the code under test\.\*\*/);
});

test('the coverage anchor rule is positioned after the Path:Line note and before the Calibration block', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  const pathLineStart = d.indexOf('> **`Path:Line` must be file-native');
  const calibStart = d.indexOf('CALIBRATION (required):');
  const coverageStart = d.indexOf('> **Coverage findings anchor at the code under test.**');

  assert.notEqual(pathLineStart, -1, 'Path:Line note not found');
  assert.notEqual(coverageStart, -1, 'coverage anchor rule not found');
  assert.notEqual(calibStart, -1, 'Calibration block not found');

  assert.ok(pathLineStart < coverageStart, 'coverage rule should be after Path:Line note');
  assert.ok(coverageStart < calibStart, 'coverage rule should be before Calibration block');
});

test('the coverage anchor rule states both halves: coverage gap at production line, test-quality defect at test line', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  const sec = between(d, '> **Coverage findings anchor at the code under test.**', '> **Scratch path');

  // Must mention missing test explicitly (not just weak test or missing assertion)
  assert.match(sec, /missing test/i, 'must name missing test case');

  // Split on period-space to isolate the two halves
  const sentences = sec.split(/\.\s+/).filter(s => s.trim());
  assert.ok(sentences.length >= 2, 'rule must have at least two sentences (coverage gap half and test-quality defect half)');

  // Coverage-gap half: must name production line and explicitly say "never at the test"
  const coverageHalf = sentences.find(s => /coverage gap|missing test|weak test/i.test(s));
  assert.ok(coverageHalf, 'must have a coverage-gap sentence');
  assert.match(coverageHalf, /production line|code.*should verify/i, 'coverage-gap sentence must name the production line');
  assert.match(coverageHalf, /never at the test/i, 'coverage-gap sentence must explicitly say "never at the test"');

  // Test-defect half: must name test line and NOT name production line
  const testDefectHalf = sentences.find(s => /test.quality.defect|test.*defect|refactor.coupled/i.test(s));
  assert.ok(testDefectHalf, 'must have a test-quality-defect sentence');
  assert.match(testDefectHalf, /test line/i, 'test-defect sentence must name the test line');
  assert.doesNotMatch(testDefectHalf, /production line|code.*should verify/i, 'test-defect sentence must NOT mention production line');

  // Must state the rule goes in the dispatch prompt
  assert.match(sec, /dispatch prompt|dispatch.*prompt/i, 'must state the rule goes in the dispatch prompt');
});

test('the Calibration block does not contain the coverage anchor rule text', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  const calStart = d.indexOf('CALIBRATION (required):');
  const calEnd = d.indexOf('Self-check before sending');
  assert.ok(calStart !== -1 && calEnd > calStart, 'Calibration block anchors not found');
  const cal = d.slice(calStart, calEnd);
  assert.doesNotMatch(cal, /Coverage findings anchor at the code under test/);
  assert.doesNotMatch(cal, /code under test/);
});

test('the 3f: Test Quality section contains exactly one bullet restating the coverage anchor rule', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  const sec = between(d, '### 3f: Test Quality', '### 3g:');

  // Count how many times the specific anchor rule bullet appears — look for the
  // unique phrase that identifies it
  const ruleBullets = sec.split('\n').filter(bullet =>
    /\*\*Coverage findings anchor at the code under test:\*\*/.test(bullet)
  );

  assert.equal(ruleBullets.length, 1, `3f section should have exactly one bullet with "**Coverage findings anchor at the code under test:**", found ${ruleBullets.length}`);

  const ruleBullet = ruleBullets[0];

  // Must mention missing test explicitly
  assert.match(ruleBullet, /missing test/i, '3f bullet must name missing test case');

  // Split on semicolon or conjunction to find the two halves
  const halves = ruleBullet.split(/;|when it's a/).map(s => s.trim());
  assert.ok(halves.length >= 2, '3f bullet must state both coverage-gap and test-defect halves');

  // Coverage-gap half: must name production line and refer to code under test
  const coverageHalf = halves[0];
  assert.match(coverageHalf, /coverage gap|missing test|weak test|insufficient case/i, 'coverage half must describe coverage gaps');
  assert.match(coverageHalf, /production line|code.*under test|anchor.*at/i, 'coverage half must name where to anchor');
  assert.doesNotMatch(coverageHalf, /anchor.*at.*test line/i, 'coverage half must NOT say anchor at test line');

  // Test-defect half: must name test line and NOT mention production line
  const testDefectHalf = halves[halves.length - 1];
  assert.match(testDefectHalf, /test.quality.defect|test.*defect|refactor.coupled|non.discriminating/i, 'test-defect half must describe test defects');
  assert.match(testDefectHalf, /anchor.*at.*test line|test line/i, 'test-defect half must name test line');
  assert.doesNotMatch(testDefectHalf, /production line|code.*under test/i, 'test-defect half must NOT mention production line');
});
