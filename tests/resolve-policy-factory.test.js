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
const { FACTORY_POLICY_ENV, FACTORY_POLICY_FILE_ENV, FACTORY_REFUSED_KEYS, FACTORY_POLICY_REL_PATH, readFactoryPolicy } = require('../plugin/bin/lib/policy-factory');
const { run, realDeps } = require('../plugin/bin/resolve-policy');
const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');

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
    assert.strictEqual(calls[0][1], lines[key].slice(key.length + 2).trimEnd(), `${key}: onInvalid carries the raw value`);
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
  // Final review Minor 5: the additive repoInvalid marker carries the malformed repo side to JSON consumers;
  // `invalid` keeps meaning "degraded to the schema default", so it stays off.
  assert.deepStrictEqual(r['risk-path-globs'], { value: { auth: ['src/auth/**'] }, source: 'factory', repoInvalid: true });
  assert.strictEqual(risk.calls.length, 1, 'the malformed repo side is still reported');

  const d = resolvePolicyKeys(['express-driver-models'], {
    policyRaw: BAD_DRIVER,
    factoryRaw: 'express-driver-models:\n  implementer: fast\n',
  });
  assert.deepStrictEqual(d['express-driver-models'], { value: { ...DRIVER_DEFAULTS, implementer: 'fast' }, source: 'factory', repoInvalid: true });

  assert.deepStrictEqual(
    modelProfilesEntry(BAD_PROFILES, 'model-profiles:\n  fast:\n    model: haiku\n'),
    { value: { fast: { model: 'haiku' } }, source: 'factory', repoInvalid: true },
  );
});

test('repoInvalid is set only when a malformed repo block yields to factory rows', () => {
  // An empty-but-valid repo block yielding to the factory is not malformed.
  assert.deepStrictEqual(
    resolvePolicyKeys(['express-driver-models'], { policyRaw: 'express-driver-models:\n', factoryRaw: 'express-driver-models:\n  implementer: fast\n' })['express-driver-models'],
    { value: { ...DRIVER_DEFAULTS, implementer: 'fast' }, source: 'factory' },
  );
  // A malformed repo block with no factory side degrades as before: invalid, no marker.
  assert.deepStrictEqual(resolvePolicyKeys(['risk-path-globs'], { policyRaw: BAD_RISK })['risk-path-globs'], { value: null, source: 'default', invalid: true });
  assert.deepStrictEqual(modelProfilesEntry(BAD_PROFILES, null), { value: null, source: 'default', invalid: true });
  // Both malformed: invalid, no marker.
  assert.deepStrictEqual(modelProfilesEntry(BAD_PROFILES, BAD_PROFILES), { value: null, source: 'default', invalid: true });
});

test('repoInvalid reaches resolve-policy.js JSON for each block key', () => {
  const repo = cliRepo({ policy: `${BAD_DRIVER}${BAD_RISK}${BAD_PROFILES}` });
  const variable = 'express-driver-models:\n  implementer: fast\nrisk-path-globs:\n  auth: [src/auth/**]\nmodel-profiles:\n  fast:\n    model: haiku\n';
  const r = cli(['express-driver-models,risk-path-globs,model-profiles'], { repo, variable });
  const parsed = JSON.parse(r.stdout);
  for (const key of ['express-driver-models', 'risk-path-globs', 'model-profiles']) {
    assert.strictEqual(parsed[key].source, 'factory', key);
    assert.strictEqual(parsed[key].repoInvalid, true, key);
    assert.strictEqual(parsed[key].invalid, undefined, key);
  }
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

test('factory risk-path-globs row naming a category neither source declares is rejected', () => {
  const alone = collect();
  const r = resolvePolicyKeys(['risk-path-globs'], { factoryRaw: 'risk-path-globs:\n  payments: [p/**]\n', onInvalid: alone.onInvalid });
  assert.deepStrictEqual(r['risk-path-globs'], { value: null, source: 'default', invalid: true });
  assert.deepStrictEqual(alone.calls, [['risk-path-globs', 'risk-path-globs:\n  payments: [p/**]']]);
  // Beside a valid repo block the factory block is still rejected, and the repo rows stand.
  const beside = collect();
  const withRepo = resolvePolicyKeys(['risk-path-globs'], {
    policyRaw: 'risk-path-globs:\n  migrations: [db/**]\n',
    factoryRaw: 'risk-path-globs:\n  payments: [p/**]\n',
    onInvalid: beside.onInvalid,
  });
  assert.deepStrictEqual(withRepo['risk-path-globs'], { value: { migrations: ['db/**'] }, source: 'policy' });
  assert.deepStrictEqual(beside.calls.map(([key]) => key), ['risk-path-globs']);
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

// ---------------------------------------------------------------------------
// bin/resolve-policy.js — the CLI envelope and stderr lines (in-process run(argv, deps))
// ---------------------------------------------------------------------------

// The runner's FACTORY_POLICY_FILE_ENV is dropped too: these cases read the factory file under an injected home.
const CLEAN_ENV = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GH_HOST', 'GH_REPO', FACTORY_POLICY_ENV, FACTORY_POLICY_FILE_ENV]) delete CLEAN_ENV[k];

const scratch = [];
test.after(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });
function tmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `rp-factory-${prefix}-`)));
  scratch.push(d);
  return d;
}
function cliRepo({ policy, runConfig } = {}) {
  const dir = tmp('repo');
  require('node:child_process').execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: CLEAN_ENV, stdio: 'ignore', windowsHide: true });
  fs.mkdirSync(path.join(dir, '.claude-tweaks', 'pipelines', 'r'), { recursive: true });
  if (policy !== undefined) fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), policy);
  if (runConfig !== undefined) fs.writeFileSync(path.join(dir, '.claude-tweaks', 'pipelines', 'r', 'config.yml'), runConfig);
  return dir;
}
function homeWith(factoryFile) {
  const home = tmp('home');
  if (factoryFile !== undefined) {
    fs.mkdirSync(path.join(home, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(home, FACTORY_POLICY_REL_PATH), factoryFile);
  }
  return home;
}
function cli(argv, { repo, home, variable } = {}) {
  const out = []; const err = [];
  const env = { ...CLEAN_ENV, ...(variable === undefined ? {} : { [FACTORY_POLICY_ENV]: variable }) };
  const code = run(argv, { ...realDeps, cwd: () => repo, env, homeDir: () => home || homeWith(), stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
  return { code, stdout: out.join(''), stderr: err.join('') };
}
const NOTE = (origin, keys) => `resolve-policy: note — factory layer (${origin}) supplied ${keys}\n`;

test('AC1: CLI prints the factory envelope', () => {
  const repo = cliRepo();
  const r = cli(['model-stance'], { repo, variable: 'model-stance: economy\n' });
  assert.deepStrictEqual(r, { code: 0, stdout: '{"model-stance":{"value":"economy","source":"factory"}}\n', stderr: NOTE('env', 'model-stance') });
  const viaPolicy = cli(['model-stance'], { repo: cliRepo({ policy: 'model-stance: max-rigor\n' }), variable: 'model-stance: economy\n' });
  assert.deepStrictEqual(viaPolicy, { code: 0, stdout: '{"model-stance":{"value":"max-rigor","source":"policy"}}\n', stderr: '' });
  const viaRun = cli(['--run', path.join('.claude-tweaks', 'pipelines', 'r'), 'model-stance'], {
    repo: cliRepo({ policy: 'model-stance: max-rigor\n', runConfig: 'model-stance: default\n' }), variable: 'model-stance: economy\n',
  });
  assert.deepStrictEqual(viaRun, { code: 0, stdout: '{"model-stance":{"value":"default","source":"run-config"}}\n', stderr: '' });
});

test('AC2.1: the same three cases from factory-policy.yml under the injected home, no variable', () => {
  const home = homeWith('model-stance: economy\n');
  const r = cli(['model-stance'], { repo: cliRepo(), home });
  assert.deepStrictEqual(r, { code: 0, stdout: '{"model-stance":{"value":"economy","source":"factory"}}\n', stderr: NOTE('file', 'model-stance') });
  assert.strictEqual(cli(['model-stance'], { repo: cliRepo({ policy: 'model-stance: max-rigor\n' }), home }).stdout, '{"model-stance":{"value":"max-rigor","source":"policy"}}\n');
  const viaRun = cli(['--run', path.join('.claude-tweaks', 'pipelines', 'r'), 'model-stance'], { repo: cliRepo({ runConfig: 'model-stance: default\n' }), home });
  assert.deepStrictEqual(viaRun, { code: 0, stdout: '{"model-stance":{"value":"default","source":"run-config"}}\n', stderr: '' });
});

test('AC2.2: both present and disagreeing, the variable wins', () => {
  const repo = cliRepo();
  const both = homeWith('model-stance: max-rigor\nautonomy: trusted\n');
  const r = cli(['model-stance,autonomy'], { repo, home: both, variable: 'model-stance: economy\n' });
  assert.deepStrictEqual(JSON.parse(r.stdout), { 'model-stance': { value: 'economy', source: 'factory' }, autonomy: { value: 'trusted', source: 'factory' } });
  assert.strictEqual(r.stderr, NOTE('env+file', 'model-stance, autonomy'));
  const only = homeWith('model-stance: max-rigor\n');
  const alone = cli(['model-stance'], { repo, home: only, variable: 'model-stance: economy\n' });
  assert.strictEqual(alone.stdout, '{"model-stance":{"value":"economy","source":"factory"}}\n');
  assert.strictEqual(alone.stderr, NOTE('env', 'model-stance'));
});

test('AC3.2: --values names the invalid factory value', () => {
  const r = cli(['--values', 'model-stance'], { repo: cliRepo(), variable: 'model-stance: nonsense\n' });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, 'default\n');
  // Final review Minor 4: the existing line, naming the factory layer as the value's source.
  assert.strictEqual(r.stderr, 'resolve-policy: warning: model-stance has invalid value "nonsense" in the factory layer — using default "default"\n');
});

test('AC3.2, AC5: a policy.yml-sourced invalid value keeps the line byte-identical, a factory layer present or not', () => {
  const line = 'resolve-policy: warning: model-stance has invalid value "nonsense" — using default "default"\n';
  const repo = cliRepo({ policy: 'model-stance: nonsense\n' });
  assert.strictEqual(cli(['--values', 'model-stance'], { repo }).stderr, line);
  // The repo's value wins precedence, so the factory value behind it is never the rejected one.
  assert.strictEqual(cli(['--values', 'model-stance'], { repo, variable: 'model-stance: also-bad\n' }).stderr, line);
  // A run-config invalid value is not the factory's either.
  const runRepo = cliRepo({ runConfig: 'model-stance: nonsense\n' });
  const viaRun = cli(['--values', '--run', path.join('.claude-tweaks', 'pipelines', 'r'), 'model-stance'], { repo: runRepo, variable: 'model-stance: economy\n' });
  assert.strictEqual(viaRun.stderr, line);
});

test('AC5.1: --all with no variable and no file is deterministic, stays on repo sources, and differs only when a factory supplies a key', () => {
  const repo = cliRepo({ policy: 'model-stance: max-rigor\n' });
  const bare = cli(['--all'], { repo, home: homeWith() });
  const again = cli(['--all'], { repo, home: tmp('empty-home') });
  assert.strictEqual(bare.code, 0);
  assert.strictEqual(bare.stderr, '');
  assert.strictEqual(bare.stdout, again.stdout);
  const parsed = JSON.parse(bare.stdout);
  assert.deepStrictEqual(Object.keys(parsed), POLICY_KEYS.map((row) => row.key));
  for (const [key, entry] of Object.entries(parsed)) assert.ok(['run-config', 'policy', 'default', undefined].includes(entry.source) || entry.error, `${key}: ${entry.source}`);
  const expected = resolvePolicyKeys(['model-stance'], { policyRaw: 'model-stance: max-rigor\n' })['model-stance'];
  assert.deepStrictEqual({ value: parsed['model-stance'].value, source: parsed['model-stance'].source }, expected);
  const withFactory = cli(['--all'], { repo, variable: 'tidy-aggressiveness: aggressive\n' });
  assert.strictEqual(JSON.parse(withFactory.stdout)['tidy-aggressiveness'].source, 'factory');
});

test('AC7.1, AC7.2: unreadable factory file resolves as absent, one warning line, nothing throws, exit 0', () => {
  const home = tmp('home');
  fs.mkdirSync(path.join(home, FACTORY_POLICY_REL_PATH), { recursive: true }); // a directory where the file belongs: EISDIR
  const r = cli(['model-stance'], { repo: cliRepo(), home });
  assert.deepStrictEqual(r, {
    code: 0,
    stdout: '{"model-stance":{"value":"default","source":"default"}}\n',
    stderr: 'resolve-policy: warning: could not read ~/.claude-tweaks/factory-policy.yml (EISDIR) — factory file ignored\n',
  });
});

test('AC11: refused keys warn once each, in JSON mode and --values mode', () => {
  const variable = 'merge-authorization: pre-authorized\ncontrol-mode: on\ndeploy-command: echo hi\nrelease-hook: echo hi\nmodel-stance: economy\n';
  const warn = (key) => `resolve-policy: warning: ${key} is not settable from the factory layer — ignored\n`;
  for (const key of FACTORY_REFUSED_KEYS) {
    const json = cli([key], { repo: cliRepo(), variable });
    assert.strictEqual(json.code, 0, key);
    assert.strictEqual(json.stderr, warn(key), `${key}: JSON mode, once`);
    assert.strictEqual(JSON.parse(json.stdout)[key].source, 'default', key);
    assert.strictEqual(cli(['--values', key, key], { repo: cliRepo(), variable }).stderr, warn(key), `${key}: --values mode, a repeated key warns once`);
  }
  const mixed = cli(['control-mode', 'model-stance'], { repo: cliRepo(), variable });
  assert.strictEqual(mixed.stderr, warn('control-mode') + NOTE('env', 'model-stance'));
  assert.strictEqual(cli(['model-stance'], { repo: cliRepo(), variable }).stderr, NOTE('env', 'model-stance'), 'an unrequested refused key stays silent');
});

test('--all writes the factory note and one refused-key line per refused key', () => {
  const note = cli(['--all'], { repo: cliRepo(), variable: 'tidy-aggressiveness: aggressive\n' });
  assert.ok(note.stderr.split('\n').includes(NOTE('env', 'tidy-aggressiveness').trimEnd()), note.stderr);
  const warn = 'resolve-policy: warning: control-mode is not settable from the factory layer — ignored';
  const refused = cli(['--all'], { repo: cliRepo(), variable: 'control-mode: on\n' });
  assert.strictEqual(refused.stderr.split('\n').filter((line) => line === warn).length, 1, refused.stderr);
  assert.strictEqual(JSON.parse(refused.stdout)['control-mode'].source, 'default');
});

test('a malformed factory block beside a valid repo block warns once and the repo rows still resolve', () => {
  const warn = (key) => `resolve-policy: warning: ${key} has a malformed block in the factory layer — ignored, using the repository's rows\n`;
  const repoDriver = 'express-driver-models:\n  implementer: fast\n';
  const driver = cli(['express-driver-models'], { repo: cliRepo({ policy: repoDriver }), variable: BAD_DRIVER });
  assert.strictEqual(driver.stderr, warn('express-driver-models'));
  assert.deepStrictEqual(JSON.parse(driver.stdout)['express-driver-models'], { value: { ...DRIVER_DEFAULTS, implementer: 'fast' }, source: 'policy' });
  const risk = cli(['risk-path-globs'], { repo: cliRepo({ policy: 'risk-path-globs:\n  migrations: [db/**]\n' }), variable: BAD_RISK });
  assert.strictEqual(risk.stderr, warn('risk-path-globs'));
  assert.deepStrictEqual(JSON.parse(risk.stdout)['risk-path-globs'], { value: { migrations: ['db/**'] }, source: 'policy' });
  const profiles = cli(['model-profiles'], { repo: cliRepo({ policy: 'model-profiles:\n  fast:\n    model: haiku\n' }), variable: BAD_PROFILES });
  assert.strictEqual(profiles.stderr, warn('model-profiles'));
  assert.deepStrictEqual(JSON.parse(profiles.stdout)['model-profiles'], { value: { fast: { model: 'haiku' } }, source: 'policy' });
  const all = cli(['--all'], { repo: cliRepo({ policy: repoDriver }), variable: BAD_DRIVER });
  assert.ok(all.stderr.split('\n').includes(warn('express-driver-models').trimEnd()), all.stderr);
  assert.strictEqual(cli(['express-driver-models'], { repo: cliRepo({ policy: repoDriver }) }).stderr, '', 'no factory side, no line');
});

test('factoryOrigin never appears on stdout', () => {
  const r = cli(['model-stance', 'autonomy'], { repo: cliRepo(), variable: 'model-stance: economy\nautonomy: trusted\n' });
  assert.ok(!r.stdout.includes('"factoryOrigin"') && !r.stdout.includes('env+file'), r.stdout);
  assert.deepStrictEqual(Object.keys(JSON.parse(r.stdout)['model-stance']), ['value', 'source']);
  const all = cli(['--all'], { repo: cliRepo(), variable: 'model-stance: economy\n' });
  assert.ok(!all.stdout.includes('"factoryOrigin"'));
});

test('resolveIntegrationModel reads the factory through an injected factoryReadFile', () => {
  const seen = [];
  const out = resolveIntegrationModel('/nonexistent-repo-root', {
    env: {}, homeDir: () => '/fake-home',
    factoryReadFile: (p) => { seen.push(p); return 'integration-model: local-merge\n'; },
  });
  assert.strictEqual(out, 'local-merge');
  assert.deepStrictEqual(seen, [path.join('/fake-home', FACTORY_POLICY_REL_PATH)]);
});

test('resolvePolicy reads the factory file through deps.factoryReadFile', () => {
  const { resolvePolicy } = require('../plugin/bin/resolve-policy');
  const repo = cliRepo();
  const seen = [];
  const out = resolvePolicy({ keys: ['model-stance'] }, {
    ...realDeps, cwd: () => repo, env: { ...CLEAN_ENV }, homeDir: () => '/fake-home',
    factoryReadFile: (p) => { seen.push(p); return 'model-stance: economy\n'; },
  });
  assert.deepStrictEqual(out.result['model-stance'], { value: 'economy', source: 'factory' });
  assert.deepStrictEqual(seen, [path.join('/fake-home', FACTORY_POLICY_REL_PATH)]);
});

// merge-verification alone resolves integration-model through resolveIntegrationModel (pickInjected
// carries deps.factoryReadFile there), so the injected reader sees both factory reads.
test('resolvePolicy hands deps.factoryReadFile to the merge-verification integration-model read', () => {
  const { resolvePolicy } = require('../plugin/bin/resolve-policy');
  const repo = cliRepo();
  const seen = [];
  const out = resolvePolicy({ keys: ['merge-verification'] }, {
    ...realDeps, cwd: () => repo, env: { ...CLEAN_ENV }, homeDir: () => '/fake-home',
    factoryReadFile: (p) => { seen.push(p); return 'integration-model: local-merge\n'; },
  });
  assert.deepStrictEqual(out.result['merge-verification'], { value: 'off', source: 'default' });
  const factoryPath = path.join('/fake-home', FACTORY_POLICY_REL_PATH);
  assert.deepStrictEqual(seen, [factoryPath, factoryPath]);
});
