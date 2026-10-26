'use strict';
// When a record's Current State names the callers or gates that should
// benefit, at least one acceptance criterion is phrased at a named consumer,
// not only at the new mechanism's interface (#3002: every AC tested
// `--stamp-status --scope`, and the three gates it named still read bare
// `--stamp-status`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const TEMPLATE = readText(path.join(__dirname, '..', 'plugin/skills/specify/spec-template.md'));

function acSection() {
  const start = TEMPLATE.indexOf('## Acceptance Criteria\n');
  const end = TEMPLATE.indexOf('## Release Note', start);
  assert.ok(start >= 0 && end > start, 'spec-template.md must have ## Acceptance Criteria followed by ## Release Note');
  return TEMPLATE.slice(start, end);
}

test('the AC template requires a criterion phrased at a consumer the Current State names', () => {
  const ac = acSection();
  assert.match(ac, /When `## Current State` names the callers, gates, or user-visible outcome/);
  assert.match(ac, /at least one criterion is phrased at one of those named consumers/);
  assert.match(ac, /not only at the new mechanism's own interface/);
  assert.match(ac, /`## Gotchas` names the follow-up record that wires the consumers/);
});

test('the consumer-facing AC rule cites the #3002 incident', () => {
  assert.match(acSection(), /#3002's Current State named three gates/);
});
