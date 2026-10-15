'use strict';
// A count-based acceptance criterion is written relative to the record's own
// change, never as a file's absolute total (#2709 vs #2706/#2707 in PR #2850).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE = fs.readFileSync(
  path.join(__dirname, '..', 'plugin/skills/specify/spec-template.md'), 'utf8');

function acSection() {
  const start = TEMPLATE.indexOf('## Acceptance Criteria\n');
  const end = TEMPLATE.indexOf('## Release Note', start);
  assert.ok(start >= 0 && end > start, 'spec-template.md must have ## Acceptance Criteria followed by ## Release Note');
  return TEMPLATE.slice(start, end);
}

test('the AC template states counts relative to the change, never as an absolute total', () => {
  const ac = acSection();
  assert.match(ac, /states the count relative to this record's own change/);
  assert.match(ac, /never as a file's absolute total/);
  assert.match(ac, /the count must match what the record's body names/);
});

test('the AC count rule cites the sibling-collision incident', () => {
  assert.match(acSection(), /#2709's "the checklist still has 20 rows"/);
});
