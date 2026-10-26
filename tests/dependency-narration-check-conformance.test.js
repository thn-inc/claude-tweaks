// tests/dependency-narration-check-conformance.test.js
// Pins plugin/skills/_shared/dependency-narration-check.md's key anchors and each of
// its two consumers' citation of it (#1423). Extracted as a new _shared contract with
// exactly two consumers (capture, specify) -- per the shared-contract-extraction skill's
// step 5, a new contract's citations need a conformance pin, and its docs/skill-graph.md
// edge is stated once under the alphabetically-first citing skill, never restated.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(REPO_ROOT, rel));

const CONTRACT_PATH = 'plugin/skills/_shared/dependency-narration-check.md';
const CONTRACT = read(CONTRACT_PATH);

function collapseWhitespace(s) {
  return s.replace(/\s+/g, ' ');
}

const CONTRACT_ANCHORS = [
  '## What it catches',
  '## The check (content judgment, not a keyword match)',
  '## Populating the edge',
  'Auto-populate always',
];

for (const anchor of CONTRACT_ANCHORS) {
  test(`dependency-narration-check.md states "${anchor}"`, () => {
    assert.ok(CONTRACT.includes(anchor), anchor);
  });
}

test('dependency-narration-check.md names the native link-records.js blocked-by invocation', () => {
  assert.ok(CONTRACT.includes('link-records.js" --blocked-by'));
});

test('dependency-narration-check.md names the body-text Blocked-by line form', () => {
  assert.ok(CONTRACT.includes('Blocked by #{n}'));
});

// --- each consumer cites the contract (case-insensitive, content-anchored), paired
// with a whitespace-spanning control per the extraction skill's step 1 gotcha ---

const CONSUMER_FILES = [
  'plugin/skills/capture/SKILL.md',
  'plugin/skills/specify/shaping-mode.md',
];

for (const rel of CONSUMER_FILES) {
  test(`${rel} cites _shared/dependency-narration-check.md (case-insensitive)`, () => {
    const content = read(rel);
    assert.match(content, /_shared\/dependency-narration-check\.md/i, rel);
  });

  test(`${rel} cites _shared/dependency-narration-check.md (whitespace-spanning control)`, () => {
    const collapsed = collapseWhitespace(read(rel));
    assert.match(collapsed, /_shared\/dependency-narration-check\.md/i, rel);
  });
}

// --- docs/skill-graph.md states the edge exactly once, under capture (the
// alphabetically-first of the two citing skills) -- not restated under specify ---

test('docs/skill-graph.md carries exactly one edge to the new contract', () => {
  const graph = read('docs/skill-graph.md');
  const matches = graph.match(/_shared\/dependency-narration-check\.md/g) || [];
  assert.equal(matches.length, 1, `found ${matches.length} edges, expected exactly 1`);
});

test('docs/skill-graph.md states the edge under the capture section, not specify', () => {
  const graph = read('docs/skill-graph.md');
  const captureSection = graph.slice(graph.indexOf('\n## capture\n'), graph.indexOf('\n## challenge\n'));
  const specifySection = graph.slice(graph.indexOf('\n## specify\n'), graph.indexOf('\n## stories\n'));
  assert.ok(captureSection.includes('_shared/dependency-narration-check.md'), 'expected the edge under ## capture');
  assert.ok(!specifySection.includes('_shared/dependency-narration-check.md'), 'edge must not be restated under ## specify');
});
