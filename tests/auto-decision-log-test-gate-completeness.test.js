'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #1058: auto-decision-log.md's canonical entry schema did not require a
// test-gate entry that names specific failure causes to account for every
// failure in a stated count — a partial named list (e.g. "8 fail: {6 named
// categories}") could be mistaken for a complete enumeration. Observed on
// #994's wrap-up: a decisions.md entry named 6 of 8 failure categories,
// silently omitting 2.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const AUTO_DECISION_LOG = read('plugin', 'skills', '_shared', 'auto-decision-log.md');

const ENTRY_SCHEMA_IDX = AUTO_DECISION_LOG.indexOf('## Entry schema');
const COMPLETENESS_IDX = AUTO_DECISION_LOG.indexOf('## Failure-cause completeness');
const LEVER_IDX = AUTO_DECISION_LOG.indexOf('## Lever attribution');
const COMPLETENESS_SECTION = AUTO_DECISION_LOG.substring(COMPLETENESS_IDX, LEVER_IDX);

test('auto-decision-log.md requires test-gate failure-cause enumeration completeness', () => {
  assert.match(AUTO_DECISION_LOG, /Failure-cause completeness/);
});

test('auto-decision-log.md requires every failure be named or an explicit partial signal', () => {
  assert.match(COMPLETENESS_SECTION, /see full log at/);
});

test('auto-decision-log.md warns against an unsignaled partial named list', () => {
  assert.match(COMPLETENESS_SECTION, /Never write a partial named list/);
});

test('auto-decision-log.md cites the #994 incident that motivated this rule', () => {
  assert.match(COMPLETENESS_SECTION, /#994/);
});

test('the completeness rule appears between Entry schema and Lever attribution', () => {
  assert.ok(ENTRY_SCHEMA_IDX > -1 && COMPLETENESS_IDX > -1 && LEVER_IDX > -1, 'all three sections must exist');
  assert.ok(ENTRY_SCHEMA_IDX < COMPLETENESS_IDX, 'completeness rule must follow Entry schema');
  assert.ok(COMPLETENESS_IDX < LEVER_IDX, 'completeness rule must precede Lever attribution');
});
