'use strict';
// tests/build-verify-after-doc-steps.test.js — pins #3060: build's journeys (Common Step 6) and
// docs sync (Common Step 6.5) must run before final verification (Common Step 5), so the verified
// tree includes them. Common Steps are executed in file order, so the headings' order is the
// execution order.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const BUILD_SKILL = readText(path.join(ROOT, 'plugin', 'skills', 'build', 'SKILL.md'));

function section(heading) {
  const start = BUILD_SKILL.indexOf(heading);
  assert.ok(start > -1, `heading must exist: ${heading}`);
  const next = BUILD_SKILL.indexOf('\n### ', start + heading.length);
  return BUILD_SKILL.slice(start, next === -1 ? undefined : next);
}

test('AC1.1: Common Step headings appear in execution order 4.5 < 6 < 6.5 < 5 < 5.5 < 7', () => {
  const headings = [
    '### Common Step 4.5',
    '### Common Step 6:',
    '### Common Step 6.5:',
    '### Common Step 5:',
    '### Common Step 5.5:',
    '### Common Step 7:',
  ];
  const indices = headings.map((h) => BUILD_SKILL.indexOf(h));
  indices.forEach((idx, i) => assert.ok(idx > -1, `heading must exist: ${headings[i]}`));
  for (let i = 1; i < indices.length; i++) {
    assert.ok(indices[i] > indices[i - 1], `${headings[i]} must come after ${headings[i - 1]}`);
  }
});

test('AC1.2: Common Step 6 section does not contain "After verification passes"', () => {
  assert.ok(!section('### Common Step 6:').includes('After verification passes'));
});

test('AC1.3: Common Step 5 section names Common Steps 6 and 6.5', () => {
  assert.match(section('### Common Step 5:'), /Common Steps 6 and 6\.5/);
});
