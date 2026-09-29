// tests/github-write-transport-label-merge-conformance.test.js
// Pins the full-replace warning plugin/skills/_shared/github-write-transport.md's
// CRUD mapping carries for issue_write's `labels` field (#2789), and that each of
// the three MCP-transport label-write call sites cites it rather than restating it.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const TRANSPORT = read('plugin/skills/_shared/github-write-transport.md');
const HAZARD_HEADING = '### Full-replace hazard';
const HAZARD_SENTENCE = 'labels field is a full replacement, never a merge';

test('github-write-transport.md carries the full-replace hazard heading', () => {
  assert.ok(TRANSPORT.includes(HAZARD_HEADING), HAZARD_HEADING);
});

test('github-write-transport.md states the full-replace hazard in the CRUD mapping section', () => {
  assert.ok(TRANSPORT.includes(HAZARD_SENTENCE), HAZARD_SENTENCE);
});

test('github-write-transport.md names the mergeLabelNames helper and its path', () => {
  assert.ok(TRANSPORT.includes('bin/lib/issues/label-write.js'));
  assert.ok(TRANSPORT.includes('mergeLabelNames'));
});

test('github-write-transport.md\'s hazard section shows a read-then-merge-then-write shape', () => {
  assert.ok(TRANSPORT.includes('issue_read') && TRANSPORT.includes('get_labels'));
  assert.ok(TRANSPORT.includes('issue_write'));
});

const CITING_FILES = [
  'plugin/skills/_shared/issue-claims.md',
  'plugin/skills/dispatch/settle-and-merge.md',
  'plugin/skills/wrap-up/cleanup-procedures-execution.md',
];

for (const rel of CITING_FILES) {
  test(`${rel} cites github-write-transport.md's full-replace hazard`, () => {
    const content = read(rel);
    assert.ok(
      content.includes('Full-replace hazard') || content.includes('full-replace'),
      `expected ${rel} to reference the full-replace hazard`
    );
  });
}
