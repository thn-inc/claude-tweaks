'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isValidBranchName } = require('../../plugin/bin/lib/branch-name');

test('isValidBranchName: rejects whitespace/control chars, forbidden ref characters, "..", a leading "-", a trailing "/" or ".lock", "//", and non-strings; accepts ordinary names (ledger row 34)', () => {
  for (const bad of ['main\n  pull_request_target:', '', 'bad branch', '-lead', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'a..b', 'a/', 'a.lock', 'a//b', null, undefined, 42]) {
    assert.equal(isValidBranchName(bad), false, `expected ${JSON.stringify(bad)} to be invalid`);
  }
  for (const good of ['develop', 'release/2.x', 'feat.v1', 'main']) {
    assert.equal(isValidBranchName(good), true, `expected ${JSON.stringify(good)} to be valid`);
  }
});
