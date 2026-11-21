// tests/bin-lib/model-profiles/policy-keys-registration.test.js
//
// #219: pins POLICY_KEYS_READ (profiles.js's authoritative export of the five
// resolver-read policy.yml keys) against POLICY_KEYS (policy-schema.js's
// registry). If a future rename lands in profiles.js without a matching
// registration here, this goes red rather than silently drifting — the
// IL-68 shape this repeats: a resolution source's own read list is the thing
// that must stay swept, not a hand-maintained mirror of it.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { POLICY_KEYS_READ } = require('../../../plugin/bin/lib/model-profiles/profiles');
const { POLICY_KEYS } = require('../../../plugin/bin/lib/policy-schema');

test('every POLICY_KEYS_READ name is registered in POLICY_KEYS', () => {
  const registered = new Set(POLICY_KEYS.map((entry) => entry.key));
  for (const name of POLICY_KEYS_READ) {
    assert.ok(registered.has(name), `POLICY_KEYS_READ name "${name}" is missing from POLICY_KEYS`);
  }
});

// Demonstrated red per IL-105: negate the fixture and confirm the assertion
// actually fails, not just "would pass on anything".
test('the assertion above is not vacuous — a name absent from POLICY_KEYS fails it', () => {
  const registered = new Set(POLICY_KEYS.map((entry) => entry.key));
  assert.ok(!registered.has('not-a-real-policy-key'));
});
