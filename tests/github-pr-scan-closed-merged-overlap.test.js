// tests/github-pr-scan-closed-merged-overlap.test.js — pins #4819 for item 4 of
// plugin/skills/_shared/github-pr-scan.md. GitHub's `gh pr list --state closed` also returns
// MERGED PRs, so the merged and closed queries overlap. Item 4 must not claim the states are
// mutually exclusive, must say the overlap exists, and must de-duplicate the union by PR `number`
// before the `headRefName` cross-check. Prose conformance: reads the file as text and asserts
// on the item-4 paragraph (its label to the start of item 5).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const PR_SCAN_FILE = 'plugin/skills/_shared/github-pr-scan.md';
const prScanContent = readText(path.join(__dirname, '..', PR_SCAN_FILE));

const ITEM4_LABEL = '4. **Merged/closed PRs with local remnants**';
const ITEM5_START = '\n5. **Harness-health issues**';
const MERGED_QUERY = 'gh pr list --state merged --limit 50 --json number,headRefName';
const CLOSED_QUERY = 'gh pr list --state closed --limit 50 --json number,headRefName';
const BRANCH_CROSS_CHECK = 'git -C "{REPO_ROOT}" branch --list';

// The item-4 paragraph: from its label to the start of item 5. Each test calls this itself so a
// fixture drift fails that test by name rather than failing the whole module at load.
function item4Paragraph(text) {
  const start = text.indexOf(ITEM4_LABEL);
  assert.notEqual(start, -1, 'fixture assumption: item 4 label not found verbatim');
  assert.equal(text.indexOf(ITEM4_LABEL, start + 1), -1, 'fixture assumption: item 4 label occurs more than once');
  const end = text.indexOf(ITEM5_START, start);
  assert.notEqual(end, -1, 'fixture assumption: item 5 start not found after item 4');
  return text.slice(start, end);
}

test('github-pr-scan.md: item 4 label occurs once and item 5 bounds its paragraph', () => {
  const paragraph = item4Paragraph(prScanContent);
  assert.ok(paragraph.startsWith(ITEM4_LABEL), 'the paragraph must open with the item 4 label');
});

test('(a) item 4 no longer claims GitHub\'s PR states are mutually exclusive or that --state closed never overlaps --state merged', () => {
  const paragraph = item4Paragraph(prScanContent);
  assert.equal(/mutually exclusive/i.test(paragraph), false, 'item 4 still claims the PR states are mutually exclusive');
  assert.equal(/never overlaps/i.test(paragraph), false, 'item 4 still claims --state closed never overlaps --state merged');
});

test('(b) item 4 states that --state closed also returns merged PRs', () => {
  const paragraph = item4Paragraph(prScanContent);
  assert.match(paragraph, /`--state closed` also returns merged PRs/, 'item 4 must state that --state closed also returns merged PRs');
});

test('(c) item 4 de-duplicates the union of the two results by PR `number` before the headRefName cross-check', () => {
  const paragraph = item4Paragraph(prScanContent);
  const dedupAt = paragraph.search(/de-?duplicat\w*[^.;]*`number`/i);
  assert.notEqual(dedupAt, -1, 'item 4 must instruct de-duplication by PR `number`');
  const crossCheckAt = paragraph.indexOf('cross-check');
  assert.notEqual(crossCheckAt, -1, 'fixture assumption: the headRefName cross-check is no longer in item 4');
  assert.ok(dedupAt < crossCheckAt, 'the de-duplication must come before the headRefName cross-check');
});

test('(d) characterization: item 4 keeps both gh pr list queries and the branch --list cross-check', () => {
  const paragraph = item4Paragraph(prScanContent);
  for (const literal of [MERGED_QUERY, CLOSED_QUERY, BRANCH_CROSS_CHECK]) {
    assert.ok(paragraph.includes(literal), `item 4 must still contain: ${literal}`);
  }
});
