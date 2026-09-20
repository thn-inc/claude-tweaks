// tests/dispatch-settle-parked-prose.test.js
//
// Pins record #2428's --settle-parked entry point: dispatch/SKILL.md's Input
// grammar and mutual-exclusion rule, and settle-parked.md's fetch/freshness/
// batch-confirm/sequential-resume procedure.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DISPATCH_SKILL = read('plugin/skills/dispatch/SKILL.md');
const SETTLE_PARKED = read('plugin/skills/dispatch/settle-parked.md');

test('argument-hint and Input grammar advertise --settle-parked', () => {
  assert.match(DISPATCH_SKILL, /argument-hint:.*--settle-parked/);
  assert.match(DISPATCH_SKILL, /`--settle-parked`/);
});

test('--settle-parked is rejected when combined with a ref or --budget', () => {
  assert.match(DISPATCH_SKILL, /--settle-parked.*mutually exclusive/i);
});

test('--settle-parked is human-present only, never Routine-fired', () => {
  assert.match(DISPATCH_SKILL, /--settle-parked.*human-present only, never.*Routine/is);
});

test('settle-parked.md fetches bot:parked PRs and excludes BLOCKED rows separately', () => {
  assert.match(SETTLE_PARKED, /bot:parked/);
  assert.match(SETTLE_PARKED, /excluded — still live/);
  assert.match(SETTLE_PARKED, /check-resume-freshness/);
});

test('settle-parked.md renders a multi-select AskUserQuestion, distinct from resume-confirmation.md\'s single-select', () => {
  assert.match(SETTLE_PARKED, /multiSelect.*true/is);
  assert.match(SETTLE_PARKED, /multi-select/i);
});

test('settle-parked.md re-probes freshness immediately before each resume and continues past a BLOCKED result', () => {
  assert.match(SETTLE_PARKED, /second.*freshness/is);
  assert.match(SETTLE_PARKED, /continues to the next selected PR/i);
});

test('settle-parked.md resumes into the PR\'s own resolved run-dir via wrap-up, never a newly-minted one', () => {
  assert.match(SETTLE_PARKED, /PIPELINE_RUN_DIR="\{run-dir\}" \/claude-tweaks:flow "\{target\}" wrap-up/);
});

test('SKILL.md points to settle-parked.md for the full procedure', () => {
  assert.match(DISPATCH_SKILL, /settle-parked\.md/);
});
