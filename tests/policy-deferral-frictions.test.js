'use strict';
// #5933: pins the filed-record-evidence and run-filed-record-cap policy keys,
// both policyOnly (a run's config.yml never sets either).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const { POLICY_KEYS, resolvePolicyKeys } = require('../plugin/bin/lib/policy-schema');

const EVIDENCE = 'filed-record-evidence';
const CAP = 'run-filed-record-cap';
const REPO_POLICY = path.join(__dirname, '..', '.claude-tweaks', 'policy.yml');

function resolveOne(key, opts) {
  const seen = [];
  const out = resolvePolicyKeys([key], { ...opts, onInvalid: (k, raw) => seen.push([k, raw]) });
  return { entry: out[key], seen };
}

test('#5933 filed-record-evidence row: enum off|required, default off, policyOnly, advanced, pipeline-behavior', () => {
  const row = POLICY_KEYS.find((k) => k.key === EVIDENCE);
  assert.ok(row, `${EVIDENCE} missing from POLICY_KEYS`);
  assert.strictEqual(row.type, 'enum');
  assert.deepStrictEqual(row.values, ['off', 'required']);
  assert.strictEqual(row.default, 'off');
  assert.strictEqual(row.policyOnly, true);
  assert.ok(!row.policySourceExcluded);
  assert.strictEqual(row.tier, 'advanced');
  assert.strictEqual(row.category, 'pipeline-behavior');
});

test('#5933 run-filed-record-cap row: integer, min 0, no default, policyOnly', () => {
  const row = POLICY_KEYS.find((k) => k.key === CAP);
  assert.ok(row, `${CAP} missing from POLICY_KEYS`);
  assert.strictEqual(row.type, 'integer');
  assert.strictEqual(row.min, 0);
  assert.ok(!('default' in row), 'no default: unset means no cap');
  assert.strictEqual(row.policyOnly, true);
  assert.ok(!row.policySourceExcluded);
  assert.strictEqual(row.tier, 'advanced');
  assert.strictEqual(row.category, 'pipeline-behavior');
});

test('#5933 filed-record-evidence resolves off when unset, required when set, off with invalid on any other value', () => {
  assert.deepStrictEqual(resolveOne(EVIDENCE, { policyRaw: 'autonomy: trusted\n' }).entry, { value: 'off', source: 'default' });
  assert.deepStrictEqual(resolveOne(EVIDENCE, { policyRaw: `${EVIDENCE}: required\n` }).entry, { value: 'required', source: 'policy' });
  for (const raw of ['yes', 'Required', 'on']) {
    const { entry, seen } = resolveOne(EVIDENCE, { policyRaw: `${EVIDENCE}: ${raw}\n` });
    assert.deepStrictEqual(entry, { value: 'off', source: 'default', invalid: true }, raw);
    assert.deepStrictEqual(seen, [[EVIDENCE, raw]], raw);
  }
});

test('#5933 run-filed-record-cap resolves no value when unset, the integer when set, no value with invalid otherwise', () => {
  assert.deepStrictEqual(resolveOne(CAP, { policyRaw: 'autonomy: trusted\n' }).entry, { value: null, source: 'default' });
  assert.deepStrictEqual(resolveOne(CAP, { policyRaw: `${CAP}: 1\n` }).entry, { value: 1, source: 'policy' });
  assert.deepStrictEqual(resolveOne(CAP, { policyRaw: `${CAP}: 0\n` }).entry, { value: 0, source: 'policy' });
  for (const raw of ['-1', 'two', '1.5']) {
    const { entry, seen } = resolveOne(CAP, { policyRaw: `${CAP}: ${raw}\n` });
    assert.deepStrictEqual(entry, { value: null, source: 'default', invalid: true }, raw);
    assert.deepStrictEqual(seen, [[CAP, raw]], raw);
  }
});

test('#5933 policyOnly: a run config never sets either key', () => {
  const policyRaw = `${CAP}: 1\n${EVIDENCE}: required\n`;
  const runConfigRaw = `${CAP}: 9\n${EVIDENCE}: off\n`;
  assert.deepStrictEqual(resolveOne(CAP, { policyRaw, runConfigRaw }).entry, { value: 1, source: 'policy' });
  assert.deepStrictEqual(resolveOne(EVIDENCE, { policyRaw, runConfigRaw }).entry, { value: 'required', source: 'policy' });
  assert.deepStrictEqual(resolveOne(CAP, { runConfigRaw }).entry, { value: null, source: 'default' });
  assert.deepStrictEqual(resolveOne(EVIDENCE, { runConfigRaw }).entry, { value: 'off', source: 'default' });
});

test('#5933 this repository sets filed-record-evidence: required and run-filed-record-cap: 1', () => {
  const out = resolvePolicyKeys([EVIDENCE, CAP], { policyRaw: readText(REPO_POLICY) });
  assert.deepStrictEqual(out[EVIDENCE], { value: 'required', source: 'policy' });
  assert.deepStrictEqual(out[CAP], { value: 1, source: 'policy' });
});
