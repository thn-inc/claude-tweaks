'use strict';
// Review Step 1 checks that the diff reaches a caller, gate, or outcome the
// spec's Current State names, not only that each criterion is met as written
// (#3002 met every criterion while the gates its Current State named still
// read bare `--stamp-status`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const STEPS = readText(path.join(__dirname, '..', 'plugin/skills/review/code-mode-steps.md'));

function step1() {
  const start = STEPS.indexOf('## Step 1: Spec Compliance Check');
  const end = STEPS.indexOf('### Gate:', start);
  assert.ok(start >= 0 && end > start, 'code-mode-steps.md must have Step 1 followed by its Gate table');
  return STEPS.slice(start, end);
}

test('Step 1 checks the diff reaches a consumer the Current State names', () => {
  const s = step1();
  assert.match(s, /\*\*Current-State outcome reach\*\*/);
  assert.match(s, /confirm the diff reaches at least one of them/);
  assert.match(s, /`## Gotchas` names the follow-up record that wires them/);
});

test('an unreached Current-State outcome is marked partial even when every criterion is met', () => {
  const s = step1();
  assert.match(s, /mark the\s+outcome `partial` even when every criterion is `met`/);
  assert.match(s, /counts toward the Gate below like a\s+partial deliverable/);
});
