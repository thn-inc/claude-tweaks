// tests/design-wrapper-review-seed-capture-citation.test.js — pins #2999's fix:
// skills/design-wrapper/modes/review.md Step 3.6 must cite
// review-seed-capture.md with a path that resolves from the skill root
// (plugin/skills/design-wrapper/), not a bare filename that only resolves
// from the citing file's own directory (modes/). Reads the live skill file —
// this test pins prose we just wrote, not a third-party fact.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILL_ROOT = path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper');
const REVIEW_MD = path.join(SKILL_ROOT, 'modes', 'review.md');

function read(p) {
  return readText(p);
}

function stepSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `expected to find "${startMarker}"`);
  const end = endMarker ? text.indexOf(endMarker, start) : text.length;
  return text.slice(start, end === -1 ? text.length : end);
}

test('review.md Step 3.6 cites review-seed-capture.md with a skill-root-relative path', () => {
  const text = read(REVIEW_MD);
  const step = stepSlice(text, '### Step 3.6: Read the direction contract', '### Step 3.7');
  const match = step.match(/Read\s*\n?`([^`]*review-seed-capture\.md)`/);
  assert.ok(match, 'expected Step 3.6 to cite review-seed-capture.md with a backtick-quoted path');

  const citedPath = match[1];
  // The bare filename (no directory segment) only resolves from the citing
  // file's own directory (modes/), which is exactly the ENOENT-from-wrong-base
  // defect #2999 reports — never accept that shape again.
  assert.notEqual(citedPath, 'review-seed-capture.md', 'citation must not be a bare filename');

  const resolved = path.join(SKILL_ROOT, citedPath);
  assert.ok(
    fs.existsSync(resolved),
    `cited path "${citedPath}" must resolve to an existing file from the skill root (${SKILL_ROOT})`,
  );
});

test('review.md Step 3.6 no longer describes the cited file as merely "in this directory"', () => {
  const text = read(REVIEW_MD);
  const step = stepSlice(text, '### Step 3.6: Read the direction contract', '### Step 3.7');
  assert.doesNotMatch(step, /`review-seed-capture\.md` in this directory/);
});

test('review-seed-capture.md ships at skills/design-wrapper/modes/, content unchanged in shape', () => {
  const target = path.join(SKILL_ROOT, 'modes', 'review-seed-capture.md');
  assert.ok(fs.existsSync(target), 'review-seed-capture.md must ship at modes/review-seed-capture.md');
  const text = read(target);
  assert.match(text, /Design-seed:/);
});
