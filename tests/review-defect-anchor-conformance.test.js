// tests/review-defect-anchor-conformance.test.js — pins #3418: review Step 3's lens dispatch
// prompt tells each agent to anchor a finding at the defect's own line, and, when the defect
// spans several copies, at its first occurrence, so a reproduction pair anchors one defect alike.
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

const NOTE = "> **Anchor a finding on the defect's own line.**";
const COVERAGE_NOTE = '> **Coverage findings anchor at the code under test.**';

function assertAnchorRule(text) {
  const sec = between(text, NOTE, COVERAGE_NOTE);
  assert.match(sec, /Tell each dispatched agent explicitly/);
  assert.match(sec, /the defect's own line/);
  assert.match(sec, /several copies/);
  assert.match(sec, /first occurrence/);
  assert.match(sec, /dispatch prompt/);
}

test('AC3.1: the lens prompt carries the defect-anchor rule (defect line; first occurrence across copies)', () => {
  assertAnchorRule(read('review', 'step3-lens-dispatch.md'));
});

test('AC3.1 go-red: dropping the first-occurrence clause fails the same assertions', () => {
  const mutated = read('review', 'step3-lens-dispatch.md').replace(/first occurrence/g, 'some occurrence');
  assert.throws(() => assertAnchorRule(mutated));
});

test('the anchor note sits after the Path:Line note, before the Coverage note, outside the Calibration block', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  const pathLineStart = d.indexOf('> **`Path:Line` must be file-native');
  const noteStart = d.indexOf(NOTE);
  const coverageStart = d.indexOf(COVERAGE_NOTE);
  const calibStart = d.indexOf('CALIBRATION (required):');

  assert.notEqual(pathLineStart, -1, 'Path:Line note not found');
  assert.notEqual(noteStart, -1, 'defect-anchor note not found');
  assert.notEqual(coverageStart, -1, 'Coverage note not found');
  assert.notEqual(calibStart, -1, 'Calibration block not found');

  assert.ok(pathLineStart < noteStart, 'defect-anchor note should be after Path:Line note');
  assert.ok(noteStart < coverageStart, 'defect-anchor note should be before Coverage note');
  assert.ok(coverageStart < calibStart, 'Coverage note should be before Calibration block');

  const cal = between(d, 'CALIBRATION (required):', 'Self-check before sending');
  assert.doesNotMatch(cal, /defect's own line/);
});
