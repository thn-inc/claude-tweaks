'use strict';
// roleModel / modelPolicyRefusal: one driver role's model from the resolved policy (#5917).
// Fixtures come from the real policy resolvers, not hand-built entries.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const lib = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { roleModel, modelPolicyRefusal, launchTracked, MODEL_POLICY_KEYS, MODEL_REFUSED_CODE } = require(path.join(lib, 'driver', 'launch'));
const { DRIVER_ROLE_PROFILES } = require(path.join(lib, 'driver', 'roles'));
const { PROFILES } = require(path.join(lib, 'model-profiles', 'profiles'));
const { resolvePolicyKeys } = require(path.join(lib, 'policy-schema'));
const { launchWorker } = require(path.join(lib, 'driver', 'worker'));
const { scratchDir } = require('../../helpers/tmp-dir');
const { modelProfilesEntry } = require(path.join(lib, 'model-profiles', 'policy-fragment'));

const FOUR = { implementer: 'standard', reviewer: 'capable', 'merge-check': 'standard', acceptance: 'standard' };
const M = (p) => PROFILES[p].model;
const policyFrom = (policyRaw) => ({
  ...resolvePolicyKeys(MODEL_POLICY_KEYS, { policyRaw }),
  'model-profiles': modelProfilesEntry(policyRaw),
});
const refused = (role, why) => (e) => e.code === MODEL_REFUSED_CODE && e.message === `no model for driver role ${role}: ${why}`;

test('roleModel: every role resolves its default with the key unset', () => {
  for (const [role, p] of Object.entries(DRIVER_ROLE_PROFILES)) {
    assert.strictEqual(roleModel(role, policyFrom('')), M(p === 'frontier' ? 'capable' : p), role);
  }
  assert.strictEqual(roleModel('reviewer', policyFrom('')), M('capable'));
  assert.strictEqual(roleModel('implementer', policyFrom('')), M('standard'));
});

test('roleModel: a policy row overrides one role', () => {
  const policy = policyFrom('express-driver-models:\n  implementer: fast\n');
  assert.strictEqual(roleModel('implementer', policy), M('fast'));
  assert.strictEqual(roleModel('reviewer', policy), M('capable'));
});

test('roleModel: explorer resolves its code-only default, whatever the role map holds', () => {
  assert.strictEqual(roleModel('explorer', policyFrom('')), M('standard'));
  const changed = { ...policyFrom(''), 'express-driver-models': { value: { ...FOUR, implementer: 'fast' }, source: 'policy' } };
  assert.strictEqual(roleModel('explorer', changed), M('standard'));
  const empty = { ...policyFrom(''), 'express-driver-models': { value: {}, source: 'policy' } };
  assert.strictEqual(roleModel('explorer', empty), M('standard'));
});

test('roleModel: a malformed sibling key the driver never reads changes nothing', () => {
  const bad = policyFrom('frontier-run-cap: abc\n');
  for (const [role, p] of Object.entries(DRIVER_ROLE_PROFILES)) assert.strictEqual(roleModel(role, bad), M(p), role);
  assert.strictEqual(modelPolicyRefusal(bad), null);
  const withBlock = policyFrom('frontier-run-cap: abc\nmodel-profiles:\n  standard:\n    model: haiku\n');
  assert.strictEqual(roleModel('implementer', withBlock), M('fast'));
});

test('AC3.1: model-ceiling standard clamps the reviewer to the standard model', () => {
  assert.strictEqual(roleModel('reviewer', policyFrom('model-ceiling: standard\n')), M('standard'));
});

test('AC4.1: frontier resolves to the capable model (unattended)', () => {
  assert.strictEqual(roleModel('reviewer', policyFrom('express-driver-models:\n  reviewer: frontier\n')), M('capable'));
});

test('roleModel: a model-profiles row applies', () => {
  assert.strictEqual(roleModel('implementer', policyFrom('model-profiles:\n  standard:\n    model: haiku\n')), M('fast'));
});

test('AC5.1: a role absent from the map is refused, naming it', () => {
  assert.throws(() => roleModel('ghost', policyFrom('')), refused('ghost', 'no work profile in the role map'));
  const partial = { ...policyFrom(''), 'express-driver-models': { value: { reviewer: 'capable' }, source: 'policy' } };
  assert.throws(() => roleModel('implementer', partial), refused('implementer', 'no work profile in the role map'));
});

test('AC5.1: a resolve() throw is refused, naming the role', () => {
  const policy = policyFrom('model-profiles:\n  standard:\n    model: claude-sonnet-4-5\n');
  assert.throws(() => roleModel('implementer', policy), (e) =>
    e.code === MODEL_REFUSED_CODE && /^no model for driver role implementer: profile standard did not resolve \(unknown model/.test(e.message));
});

test('roleModel: a missing or non-object role map is refused', () => {
  for (const policy of [{}, { 'express-driver-models': { value: null, source: 'default', invalid: true } }]) {
    assert.throws(() => roleModel('implementer', policy), refused('implementer', 'role map unreadable'));
    assert.strictEqual(roleModel('explorer', policy), M('standard'));
  }
});

test('modelPolicyRefusal: invalid keys, then per-role refusals, else null', () => {
  assert.strictEqual(modelPolicyRefusal(policyFrom('')), null);
  assert.strictEqual(modelPolicyRefusal(policyFrom('express-driver-models:\n  implementer: turbo\n')), 'driver model policy invalid: express-driver-models');
  assert.strictEqual(modelPolicyRefusal(policyFrom('model-profiles:\n  standard:\n    speed: x\n')), 'driver model policy invalid: model-profiles');
  assert.strictEqual(modelPolicyRefusal(policyFrom('model-ceiling: huge\n')), 'driver model policy invalid: model-ceiling');
  assert.match(modelPolicyRefusal(policyFrom('model-profiles:\n  standard:\n    model: claude-sonnet-4-5\n')),
    /^no model for driver role implementer: profile standard did not resolve \(unknown model/);
});

test('roleModel: an invalid model-profiles or model-ceiling refuses on its own, for every role', () => {
  const cases = [
    ['model-ceiling', policyFrom('model-ceiling: huge\n')],
    ['model-profiles', policyFrom('model-profiles:\n  standard:\n    speed: x\n')],
  ];
  for (const [key, policy] of cases) {
    assert.strictEqual(policy[key].invalid, true, key);
    for (const role of Object.keys(DRIVER_ROLE_PROFILES)) {
      assert.throws(() => roleModel(role, policy), refused(role, `driver model policy invalid: ${key}`), `${key} ${role}`);
    }
  }
});

// The real launcher with a recording runner: the argv a launchTracked call composes.
async function composedArgs(role, policyRaw, runConfigRaw = null) {
  let seen = null;
  const shared = {
    activeWorker: null,
    policy: { ...resolvePolicyKeys(MODEL_POLICY_KEYS, { policyRaw, runConfigRaw }), 'model-profiles': modelProfilesEntry(policyRaw) },
  };
  const deps = {
    platform: 'linux',
    env: {},
    runner: (call) => { seen = call.args; return { pid: 1, kill() {}, exited: Promise.resolve({ code: 0, signal: null, stdout: '', stderr: '' }) }; },
    launchWorker: (o, d) => launchWorker(o, d),
  };
  await launchTracked(shared, deps, { minutes: 1, dollars: 1 }, { role, cwd: scratchDir('launch-cwd-'), settingsDir: scratchDir('launch-settings-'), prompt: 'p' });
  return seen;
}
const argModel = (args) => args[args.indexOf('--model') + 1];

test('AC1.1: unset key composes --model <standard> for the implementer and <capable> for the reviewer', async () => {
  const impl = await composedArgs('implementer', '');
  assert.strictEqual(argModel(impl), M('standard'));
  assert.strictEqual(impl.filter((a) => a === '--model').length, 1);
  const rev = await composedArgs('reviewer', '');
  assert.strictEqual(argModel(rev), M('capable'));
  assert.strictEqual(rev.filter((a) => a === '--model').length, 1);
});

test('AC2.1: implementer: fast in policy.yml composes --model <fast>', async () => {
  assert.strictEqual(argModel(await composedArgs('implementer', 'express-driver-models:\n  implementer: fast\n')), M('fast'));
});

test('AC2.2: the same block in config.yml composes the default model', async () => {
  assert.strictEqual(argModel(await composedArgs('implementer', '', 'express-driver-models:\n  implementer: fast\n')), M('standard'));
});

test('AC3.1 (argv): model-ceiling standard launches the reviewer on <standard>', async () => {
  assert.strictEqual(argModel(await composedArgs('reviewer', 'model-ceiling: standard\n')), M('standard'));
});

test('AC5.1: launchTracked refuses before any runner call', async () => {
  let launches = 0;
  let runs = 0;
  const shared = { activeWorker: null, policy: policyFrom('') };
  const deps = { platform: 'linux', env: {}, runner: () => { runs += 1; }, launchWorker: () => { launches += 1; } };
  await assert.rejects(() => launchTracked(shared, deps, { minutes: 1, dollars: 1 }, { role: 'ghost', prompt: 'p' }),
    (e) => e.code === MODEL_REFUSED_CODE && e.message.includes('ghost'));
  assert.deepStrictEqual([launches, runs, shared.activeWorker], [0, 0, null]);
});

test('launchTracked: the resolved model wins over a model in the caller opts', async () => {
  const shared = { activeWorker: null, policy: policyFrom('') };
  let got = null;
  const deps = { platform: 'linux', env: {}, runner: () => {}, launchWorker: (o) => { got = o; } };
  await launchTracked(shared, deps, { minutes: 1, dollars: 1 }, { role: 'implementer', model: 'opus', prompt: 'p' });
  assert.strictEqual(got.model, M('standard'));
});
