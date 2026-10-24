// tests/release-reviewed-tip-conformance.test.js — pins #4041: /release Step 5 merged whatever
// origin/{branch} held at merge time, so a commit that landed after Step 3's whole-branch review shipped
// unreviewed. Step 5 now compares origin/{branch} with the tip Step 3 reviewed, runs a delta review per
// move, and holds the release once the integration branch has moved more than the `release-tip-moves`
// policy key allows. This suite pins the key's schema row first.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');

test('release-tip-moves is an advanced merge-safety integer defaulting to 2', () => {
  const row = POLICY_KEYS.find((r) => r.key === 'release-tip-moves');
  assert.ok(row, 'release-tip-moves missing from POLICY_KEYS');
  assert.equal(row.type, 'integer');
  assert.equal(row.default, 2);
  assert.equal(row.category, 'merge-safety');
  assert.equal(row.tier, 'advanced');
});
