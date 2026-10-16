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

  // Check for both halves of the rule
  assert.match(sec, /coverage gap|missing.*test|weak.*test/i, 'should mention coverage gaps or weak tests');
  assert.match(sec, /production line|code under test/i, 'should mention the production line');
  assert.match(sec, /test.*defect|test.*quality|test.*fault|test.*issue/i, 'should mention test defects');
  assert.match(sec, /test line|test file/i, 'should mention the test line');
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

  // Verify the bullet contains both halves
  const ruleBullet = ruleBullets[0];
  assert.match(ruleBullet, /coverage gap/i);
  assert.match(ruleBullet, /production line/i);
  assert.match(ruleBullet, /test-quality defect|test.*defect/i);
  assert.match(ruleBullet, /test line/i);
});
