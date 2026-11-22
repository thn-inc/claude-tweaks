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

const { POLICY_KEY, RULES } = require('../../../plugin/bin/lib/model-profiles/implementer-tier');
const { resolvePolicyKeys } = require('../../../plugin/bin/lib/policy-schema');

test('AC9.1: implementer-tier is registered as a run-settable lane|record enum defaulting to lane', () => {
  const row = POLICY_KEYS.find((entry) => entry.key === POLICY_KEY);
  assert.ok(row, `${POLICY_KEY} is missing from POLICY_KEYS`);
  assert.strictEqual(row.type, 'enum');
  assert.deepStrictEqual(row.values, RULES);
  assert.strictEqual(row.default, 'lane');
  assert.notStrictEqual(row.policyOnly, true);
  assert.notStrictEqual(row.policySourceExcluded, true);
});

test('implementer-tier resolves run config over policy, and a bad value falls back to lane with invalid: true', () => {
  const beaten = resolvePolicyKeys([POLICY_KEY], { policyRaw: 'implementer-tier: record\n', runConfigRaw: 'implementer-tier: lane\n' });
  assert.deepStrictEqual(beaten[POLICY_KEY], { value: 'lane', source: 'run-config' });
  const seen = [];
  const bad = resolvePolicyKeys([POLICY_KEY], { policyRaw: 'implementer-tier: sometimes\n', onInvalid: (key, raw) => seen.push([key, raw]) });
  assert.deepStrictEqual(bad[POLICY_KEY], { value: 'lane', source: 'default', invalid: true });
  assert.deepStrictEqual(seen, [[POLICY_KEY, 'sometimes']]);
});
