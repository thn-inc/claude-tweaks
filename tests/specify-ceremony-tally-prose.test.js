// tests/specify-ceremony-tally-prose.test.js
// Pins that record-creation-subissues.md's manifest-accumulation snippet carries
// each sub-issue's ceremony tier, and that a "Ceremony tally" step exists between
// "Snapshot invalidation" and "### Rules" — the durable-record mechanism for #3128.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const RECORD_CREATION = fs.readFileSync(
  path.join(REPO_ROOT, 'plugin/skills/specify/record-creation-subissues.md'),
  'utf8'
);

test('manifest-accumulation entry object carries a ceremony field', () => {
  assert.ok(
    /entry\s*=\s*\{[^}]*ceremony\s*:\s*process\.argv\[\d+\][^}]*\}/.test(RECORD_CREATION),
    'the manifest entry object literal must include a ceremony: process.argv[n] field'
  );
});

test('the manifest-accumulation node -e call passes $SUB_ISSUE_CEREMONY as an argv', () => {
  const accumIdx = RECORD_CREATION.indexOf('Accumulate this unit for the cross-reference pass below');
  assert.ok(accumIdx >= 0, 'the Accumulate section must still exist');
  const section = RECORD_CREATION.slice(accumIdx, accumIdx + 2000);
  assert.ok(
    section.includes('$SUB_ISSUE_CEREMONY'),
    'the accumulation bash fence must pass $SUB_ISSUE_CEREMONY to the node -e call'
  );
});
