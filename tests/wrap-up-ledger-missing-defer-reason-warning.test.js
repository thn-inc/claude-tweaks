'use strict';
// tests/wrap-up-ledger-missing-defer-reason-warning.test.js — pins #3004: wrap-up's
// nothing-left-behind gate surfaces parseLedger's `missingDeferReason` count as an
// additive, non-blocking warning naming the rows, like the #2080 unrecognized-status one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const WRAP_UP = readText(path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'SKILL.md'));

test('AC3.1: wrap-up SKILL.md renders a non-blocking missing-Defer-reason warning naming the rows', () => {
  const start = WRAP_UP.indexOf('**Missing Defer-reason warning (#3004).**');
  assert.notStrictEqual(start, -1, 'the Missing Defer-reason warning paragraph is absent');
  const end = WRAP_UP.indexOf('\n\n', start);
  const paragraph = WRAP_UP.slice(start, end === -1 ? undefined : end);
  assert.match(paragraph, /pack\.ledger\.missingDeferReason > 0/);
  assert.match(paragraph, /missingDeferReasonItems/);
  assert.match(paragraph, /_shared\/deferral-gate\.md/);
  assert.match(paragraph, /never blocks completion/);
});
