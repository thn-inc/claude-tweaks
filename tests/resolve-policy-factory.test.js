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
const { modelProfilesEntry } = require('../plugin/bin/lib/model-profiles/policy-fragment');
const { FACTORY_POLICY_ENV, FACTORY_REFUSED_KEYS, readFactoryPolicy } = require('../plugin/bin/lib/policy-factory');

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

// ---------------------------------------------------------------------------
// block keys — express-driver-models, risk-path-globs, model-profiles merge per row
// ---------------------------------------------------------------------------

const DRIVER_DEFAULTS = resolvePolicyKeys(['express-driver-models'], {})['express-driver-models'].value;
const BAD_DRIVER = 'express-driver-models:\n  scout: fast\n';
const BAD_RISK = 'risk-path-globs:\n  nope: [a]\n';
const BAD_PROFILES = 'model-profiles:\n  standard:\n    speed: x\n';
const collect = () => {
  const calls = [];
  return { calls, onInvalid: (key, raw) => calls.push([key, raw]) };
};

// Characterization (build rule 9): the repo-only results the merge must keep.
test('block keys with no factory side keep their repo-only results', () => {
  const driver = (policyRaw) => resolvePolicyKeys(['express-driver-models'], { policyRaw })['express-driver-models'];
  assert.deepStrictEqual(driver(undefined), { value: DRIVER_DEFAULTS, source: 'default' });
  assert.deepStrictEqual(driver('express-driver-models:\n  implementer: fast\n'), { value: { ...DRIVER_DEFAULTS, implementer: 'fast' }, source: 'policy' });
  assert.deepStrictEqual(driver('express-driver-models:\n'), { value: DRIVER_DEFAULTS, source: 'policy' });
  assert.deepStrictEqual(driver(BAD_DRIVER), { value: null, source: 'default', invalid: true });
  const risk = (policyRaw) => resolvePolicyKeys(['risk-path-globs'], { policyRaw })['risk-path-globs'];
  assert.deepStrictEqual(risk(undefined), { value: {}, source: 'default' });
  assert.deepStrictEqual(risk('risk-path-globs:\n  migrations: [db/**]\n'), { value: { migrations: ['db/**'] }, source: 'policy' });
  assert.deepStrictEqual(risk(BAD_RISK), { value: null, source: 'default', invalid: true });
  assert.deepStrictEqual(modelProfilesEntry(undefined), { value: null, source: 'default' });
  assert.deepStrictEqual(modelProfilesEntry('model-profiles:\n  fast:\n    model: haiku\n'), { value: { fast: { model: 'haiku' } }, source: 'policy' });
  assert.deepStrictEqual(modelProfilesEntry(BAD_PROFILES), { value: null, source: 'default', invalid: true });
  assert.deepStrictEqual(modelProfilesEntry('model-profiles:\n  fast:\n    model: haiku\n', null), modelProfilesEntry('model-profiles:\n  fast:\n    model: haiku\n'));
});

test('AC4.1: express-driver-models merges per role', () => {
  const r = resolvePolicyKeys(['express-driver-models'], {
    policyRaw: 'express-driver-models:\n  reviewer: standard\n',
    factoryRaw: 'express-driver-models:\n  implementer: fast\n  reviewer: capable\n',
  });
  const entry = r['express-driver-models'];
  assert.strictEqual(entry.value.implementer, 'fast');
  assert.strictEqual(entry.value.reviewer, 'standard');
  assert.strictEqual(entry.source, 'policy');
});

test('express-driver-models from factory only reports source factory', () => {
  const r = resolvePolicyKeys(['express-driver-models'], { factoryRaw: 'express-driver-models:\n  implementer: fast\n' });
  assert.deepStrictEqual(r['express-driver-models'], { value: { ...DRIVER_DEFAULTS, implementer: 'fast' }, source: 'factory' });
});

test('AC4.2: model-profiles keeps a factory profile and a repo profile', () => {
  const entry = modelProfilesEntry(
    'model-profiles:\n  capable:\n    effort: high\n',
    'model-profiles:\n  fast:\n    model: haiku\n',
  );
  assert.deepStrictEqual(entry, { value: { fast: { model: 'haiku' }, capable: { effort: 'high' } }, source: 'policy' });
});

test('model-profiles merges a whole profile row, not per field', () => {
  const entry = modelProfilesEntry(
    'model-profiles:\n  fast:\n    effort: low\n',
    'model-profiles:\n  fast:\n    model: haiku\n  capable:\n    model: opus\n',
  );
  assert.deepStrictEqual(entry.value, { fast: { effort: 'low' }, capable: { model: 'opus' } });
});

test('model-profiles from factory only reports source factory', () => {
  const entry = modelProfilesEntry(undefined, 'model-profiles:\n  fast:\n    model: haiku\n');
  assert.deepStrictEqual(entry, { value: { fast: { model: 'haiku' } }, source: 'factory' });
});

test('risk-path-globs merges per category', () => {
  const r = resolvePolicyKeys(['risk-path-globs'], {
    policyRaw: 'risk-path-globs:\n  migrations: [db/**]\n',
    factoryRaw: 'risk-path-globs:\n  migrations: [other/**]\n  auth: [src/auth/**]\n',
  });
  assert.deepStrictEqual(r['risk-path-globs'], { value: { auth: ['src/auth/**'], migrations: ['db/**'] }, source: 'policy' });
});

test('risk-path-globs from factory only reports source factory', () => {
  const r = resolvePolicyKeys(['risk-path-globs'], { factoryRaw: 'risk-path-globs:\n  auth: [src/auth/**]\n' });
  assert.deepStrictEqual(r['risk-path-globs'], { value: { auth: ['src/auth/**'] }, source: 'factory' });
});

test('malformed factory block never drops repo rows', () => {
  const risk = collect();
  const r = resolvePolicyKeys(['risk-path-globs'], {
    policyRaw: 'risk-path-globs:\n  migrations: [db/**]\n',
    factoryRaw: BAD_RISK,
    onInvalid: risk.onInvalid,
  });
  assert.deepStrictEqual(r['risk-path-globs'], { value: { migrations: ['db/**'] }, source: 'policy' });
  assert.deepStrictEqual(risk.calls.map(([key]) => key), ['risk-path-globs']);

  const driver = collect();
  const d = resolvePolicyKeys(['express-driver-models'], {
    policyRaw: 'express-driver-models:\n  reviewer: standard\n',
    factoryRaw: BAD_DRIVER,
    onInvalid: driver.onInvalid,
  });
  assert.deepStrictEqual(d['express-driver-models'], { value: { ...DRIVER_DEFAULTS, reviewer: 'standard' }, source: 'policy' });
  assert.deepStrictEqual(driver.calls.map(([key]) => key), ['express-driver-models']);

  assert.deepStrictEqual(
    modelProfilesEntry('model-profiles:\n  fast:\n    model: haiku\n', BAD_PROFILES),
    { value: { fast: { model: 'haiku' } }, source: 'policy' },
  );
});

test('malformed repo block resolves from factory rows', () => {
  const risk = collect();
  const r = resolvePolicyKeys(['risk-path-globs'], {
    policyRaw: BAD_RISK,
    factoryRaw: 'risk-path-globs:\n  auth: [src/auth/**]\n',
    onInvalid: risk.onInvalid,
  });
  assert.deepStrictEqual(r['risk-path-globs'], { value: { auth: ['src/auth/**'] }, source: 'factory' });
  assert.strictEqual(risk.calls.length, 1, 'the malformed repo side is still reported');

  const d = resolvePolicyKeys(['express-driver-models'], {
    policyRaw: BAD_DRIVER,
    factoryRaw: 'express-driver-models:\n  implementer: fast\n',
  });
  assert.deepStrictEqual(d['express-driver-models'], { value: { ...DRIVER_DEFAULTS, implementer: 'fast' }, source: 'factory' });

  assert.deepStrictEqual(
    modelProfilesEntry(BAD_PROFILES, 'model-profiles:\n  fast:\n    model: haiku\n'),
    { value: { fast: { model: 'haiku' } }, source: 'factory' },
  );
});

test('malformed factory block with no repo block resolves invalid', () => {
  const risk = collect();
  assert.deepStrictEqual(
    resolvePolicyKeys(['risk-path-globs'], { factoryRaw: BAD_RISK, onInvalid: risk.onInvalid })['risk-path-globs'],
    { value: null, source: 'default', invalid: true },
  );
  assert.deepStrictEqual(risk.calls, [['risk-path-globs', 'risk-path-globs:\n  nope: [a]']]);

  const driver = collect();
  assert.deepStrictEqual(
    resolvePolicyKeys(['express-driver-models'], { factoryRaw: BAD_DRIVER, onInvalid: driver.onInvalid })['express-driver-models'],
    { value: null, source: 'default', invalid: true },
  );
  assert.deepStrictEqual(driver.calls.map(([key]) => key), ['express-driver-models']);

  assert.deepStrictEqual(modelProfilesEntry(undefined, BAD_PROFILES), { value: null, source: 'default', invalid: true });
});

test('both sides malformed resolves invalid and reports both', () => {
  const risk = collect();
  const r = resolvePolicyKeys(['risk-path-globs'], {
    policyRaw: 'risk-path-globs: x\n',
    factoryRaw: BAD_RISK,
    onInvalid: risk.onInvalid,
  });
  assert.deepStrictEqual(r['risk-path-globs'], { value: null, source: 'default', invalid: true });
  assert.deepStrictEqual(risk.calls.map(([, raw]) => raw), ['risk-path-globs: x', 'risk-path-globs:\n  nope: [a]']);
  assert.deepStrictEqual(modelProfilesEntry(BAD_PROFILES, BAD_PROFILES), { value: null, source: 'default', invalid: true });
});

test('factory risk-path-globs row naming a category defined only in policy.yml is accepted', () => {
  const r = resolvePolicyKeys(['risk-path-globs'], {
    policyRaw: 'risk-categories: payments\n',
    factoryRaw: 'risk-path-globs:\n  payments: [src/pay/**]\n',
  });
  assert.deepStrictEqual(r['risk-path-globs'].value.payments, ['src/pay/**']);
  assert.strictEqual(r['risk-path-globs'].source, 'factory');

  // The same block in the variable and the file: the variable's is kept and nothing is dropped.
  const block = 'risk-path-globs:\n  payments: [src/pay/**]\n';
  const { raw, warnings } = readFactoryPolicy({
    env: { [FACTORY_POLICY_ENV]: block, HOME: '/h' },
    readFile: () => block,
  });
  assert.deepStrictEqual(warnings, []);
  const merged = resolvePolicyKeys(['risk-path-globs'], { policyRaw: 'risk-categories: payments\n', factoryRaw: raw });
  assert.deepStrictEqual(merged['risk-path-globs'].value.payments, ['src/pay/**']);
});

test('a factory risk-categories widens the allowed slugs only when policy.yml has no risk-categories line', () => {
  const factoryRaw = 'risk-categories: payments\nrisk-path-globs:\n  payments: [src/pay/**]\n';
  assert.strictEqual(resolvePolicyKeys(['risk-path-globs'], { factoryRaw })['risk-path-globs'].source, 'factory');
  const policyOwns = resolvePolicyKeys(['risk-path-globs'], { policyRaw: 'risk-categories: other\n', factoryRaw });
  assert.deepStrictEqual(policyOwns['risk-path-globs'], { value: null, source: 'default', invalid: true });
});

test('an invalid policy.yml risk-categories never cascades to the factory one', () => {
  const r = resolvePolicyKeys(['risk-path-globs'], {
    policyRaw: 'risk-categories: Bad Slug!\n',
    factoryRaw: 'risk-categories: payments\nrisk-path-globs:\n  payments: [p/**]\n',
  });
  assert.deepStrictEqual(r['risk-path-globs'], { value: null, source: 'default', invalid: true });
});

test('a block present but empty on the repo side resolves from the factory rows with source factory', () => {
  const driver = resolvePolicyKeys(['express-driver-models'], {
    policyRaw: 'express-driver-models:\n',
    factoryRaw: 'express-driver-models:\n  implementer: fast\n',
  });
  assert.deepStrictEqual(driver['express-driver-models'], { value: { ...DRIVER_DEFAULTS, implementer: 'fast' }, source: 'factory' });
  const risk = resolvePolicyKeys(['risk-path-globs'], {
    policyRaw: 'risk-path-globs:\n',
    factoryRaw: 'risk-path-globs:\n  auth: [a/**]\n',
  });
  assert.deepStrictEqual(risk['risk-path-globs'], { value: { auth: ['a/**'] }, source: 'factory' });
  assert.deepStrictEqual(
    modelProfilesEntry('model-profiles:\n', 'model-profiles:\n  fast:\n    model: haiku\n'),
    { value: { fast: { model: 'haiku' } }, source: 'factory' },
  );
});

test('a block empty on both sides keeps source policy', () => {
  assert.deepStrictEqual(modelProfilesEntry('model-profiles:\n', 'model-profiles:\n'), { value: {}, source: 'policy' });
  const driver = resolvePolicyKeys(['express-driver-models'], { policyRaw: 'express-driver-models:\n', factoryRaw: 'express-driver-models:\n' });
  assert.deepStrictEqual(driver['express-driver-models'], { value: DRIVER_DEFAULTS, source: 'policy' });
});

test('AC10.1: a variable with an indented block resolves both rows', () => {
  const { raw } = readFactoryPolicy({
    env: { [FACTORY_POLICY_ENV]: 'express-driver-models:\n  implementer: fast\n  reviewer: capable' },
    homeDir: () => null,
  });
  const entry = resolvePolicyKeys(['express-driver-models'], { factoryRaw: raw })['express-driver-models'];
  assert.strictEqual(entry.value.implementer, 'fast');
  assert.strictEqual(entry.value.reviewer, 'capable');
  assert.strictEqual(entry.source, 'factory');
});
