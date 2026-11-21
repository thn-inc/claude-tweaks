// tests/resolve-policy-factory.test.js — the factory policy layer (#6006) as seen by
// bin/lib/policy-schema.js's resolver. Inline string fixtures only: never reads this
// repo's live policy.yml or the machine's real factory file (IL-80).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolvePolicyKeys, resolveIntegrationModel } = require('../plugin/bin/lib/policy-schema');
const { FACTORY_POLICY_ENV, FACTORY_REFUSED_KEYS } = require('../plugin/bin/lib/policy-factory');

// ---------------------------------------------------------------------------
// resolvePolicyKeys — factory as the third source (run-config -> policy -> factory -> default)
// ---------------------------------------------------------------------------

test('AC1.1: factory value resolves with source factory', () => {
  const r = resolvePolicyKeys(['model-stance'], { factoryRaw: 'model-stance: economy\n' });
  assert.deepStrictEqual(r['model-stance'], { value: 'economy', source: 'factory' });
});

test('AC1.2: policy.yml beats factory', () => {
  const r = resolvePolicyKeys(['model-stance'], {
    policyRaw: 'model-stance: max-rigor\n',
    factoryRaw: 'model-stance: economy\n',
  });
  assert.deepStrictEqual(r['model-stance'], { value: 'max-rigor', source: 'policy' });
});

test('AC1.3: run-config beats both', () => {
  const r = resolvePolicyKeys(['model-stance'], {
    runConfigRaw: 'model-stance: default\n',
    policyRaw: 'model-stance: max-rigor\n',
    factoryRaw: 'model-stance: economy\n',
  });
  assert.deepStrictEqual(r['model-stance'], { value: 'default', source: 'run-config' });
});

test('AC3.1: invalid factory value resolves default, invalid, onInvalid', () => {
  const calls = [];
  const r = resolvePolicyKeys(['model-stance'], {
    factoryRaw: 'model-stance: nonsense\n',
    onInvalid: (key, raw) => calls.push([key, raw]),
  });
  assert.deepStrictEqual(r['model-stance'], { value: 'default', source: 'default', invalid: true });
  assert.deepStrictEqual(calls, [['model-stance', 'nonsense']]);
});

test('invalid policy value does not cascade to factory', () => {
  const r = resolvePolicyKeys(['model-stance'], {
    policyRaw: 'model-stance: bogus\n',
    factoryRaw: 'model-stance: economy\n',
  });
  assert.deepStrictEqual(r['model-stance'], { value: 'default', source: 'default', invalid: true });
});

test('AC8.2: factory-only autonomy trusted derives housekeeping-auto-merge true', () => {
  const r = resolvePolicyKeys(['housekeeping-auto-merge'], { factoryRaw: 'autonomy: trusted\n' });
  assert.deepStrictEqual(r['housekeeping-auto-merge'], { value: true, source: 'default' });
});

test('AC11.1-3: refused keys resolve as with no factory layer', () => {
  assert.deepStrictEqual(FACTORY_REFUSED_KEYS, ['merge-authorization', 'control-mode', 'deploy-command', 'release-hook']);
  const lines = {
    'merge-authorization': 'merge-authorization: pre-authorized\n',
    'control-mode': 'control-mode: on\n',
    'deploy-command': 'deploy-command: echo hi\n',
    'release-hook': 'release-hook: echo hi\n',
  };
  for (const key of FACTORY_REFUSED_KEYS) {
    const calls = [];
    const r = resolvePolicyKeys([key], { factoryRaw: lines[key], onInvalid: (k, raw) => calls.push([k, raw]) });
    assert.deepStrictEqual(r[key], resolvePolicyKeys([key], {})[key], `${key} must resolve as with no factory layer`);
    assert.strictEqual(r[key].source, 'default', key);
    assert.strictEqual(calls.length, 1, `${key}: onInvalid once`);
    assert.strictEqual(calls[0][0], key);
  }
});

test('refused key beside a legal key: legal key applies', () => {
  const calls = [];
  const r = resolvePolicyKeys(['control-mode', 'model-stance'], {
    factoryRaw: 'control-mode: on\nmodel-stance: economy\n',
    onInvalid: (k) => calls.push(k),
  });
  assert.strictEqual(r['control-mode'].source, 'default');
  assert.deepStrictEqual(r['model-stance'], { value: 'economy', source: 'factory' });
  assert.deepStrictEqual(calls, ['control-mode']);
});

test('AC12.1: owned-owners from the factory layer only', () => {
  const viaPolicy = resolvePolicyKeys(['owned-owners'], { policyRaw: 'owned-owners: acme\n' })['owned-owners'];
  assert.strictEqual(viaPolicy.source, 'policy');
  const r = resolvePolicyKeys(['owned-owners'], { factoryRaw: 'owned-owners: acme\n' });
  assert.deepStrictEqual(r['owned-owners'], { ...viaPolicy, source: 'factory' });
});

test('renamed alias in factory text tags renamed-from', () => {
  const r = resolvePolicyKeys(['auto-merge-max-lines'], { factoryRaw: 'automerge-max-lines: 12\n' });
  assert.deepStrictEqual(r['auto-merge-max-lines'], {
    value: 12,
    source: 'factory',
    'renamed-from': 'automerge-max-lines',
  });
});

test('resolveIntegrationModel honours a factory pin without detection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-im-root-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-im-home-'));
  try {
    const model = resolveIntegrationModel(root, {
      env: { [FACTORY_POLICY_ENV]: 'integration-model: pr-first' },
      homeDir: () => home,
    });
    assert.strictEqual(model, 'pr-first'); // a non-repo root detects local-merge, so pr-first proves the pin
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
