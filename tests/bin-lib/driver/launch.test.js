'use strict';
// roleModel / modelPolicyRefusal: one driver role's model from the resolved policy (#5917).
// Fixtures come from the real policy resolvers, not hand-built entries.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const lib = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { roleModel, roleLaunch, modelPolicyRefusal, launchTracked, MODEL_POLICY_KEYS, MODEL_REFUSED_CODE } = require(path.join(lib, 'driver', 'launch'));
const { DRIVER_ROLE_PROFILES } = require(path.join(lib, 'driver', 'roles'));
const { PROFILES, resolve } = require(path.join(lib, 'model-profiles', 'profiles'));
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
  // attrSource (the empty tree's id) is required for the lens-reviewer and ignored by every other role.
  await launchTracked(shared, deps, { minutes: 1, dollars: 1 }, { role, cwd: scratchDir('launch-cwd-'), settingsDir: scratchDir('launch-settings-'), prompt: 'p', attrSource: '4b825dc642cb6eb9a060e54bf8d69288fbee4904' });
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
  await launchTracked(shared, deps, { minutes: 1, dollars: 1 }, { role: 'implementer', model: 'caller-model', prompt: 'p' });
  assert.strictEqual(got.model, M('standard'));
});

// #5942: the launch effort each role resolves, composed as --effort.
const argEffort = (args) => (args.includes('--effort') ? args[args.indexOf('--effort') + 1] : null);

test('#5942 AC1.1: with model-effort unset no role composes --effort', async () => {
  for (const role of Object.keys(DRIVER_ROLE_PROFILES)) {
    assert.strictEqual(argEffort(await composedArgs(role, '')), null, role);
  }
});

test('#5942 AC2.1: model-effort profile composes resolve().launchEffort for implementer and reviewer', async () => {
  for (const role of ['implementer', 'reviewer']) {
    const want = resolve(FOUR[role], { policy: { 'model-effort': 'profile' }, unattended: true }).launchEffort;
    assert.strictEqual(argEffort(await composedArgs(role, 'model-effort: profile\n')), want, role);
  }
});

test('#5942 AC2.2: with the shipped table that is high for both', async () => {
  for (const role of ['implementer', 'reviewer']) {
    assert.strictEqual(argEffort(await composedArgs(role, 'model-effort: profile\n')), 'high', role);
  }
});

test('#5942 AC3.1: a model-profiles row giving standard medium composes --effort medium for the implementer', async () => {
  const raw = 'model-effort: profile\nmodel-profiles:\n  standard:\n    effort: medium\n';
  assert.strictEqual(argEffort(await composedArgs('implementer', raw)), 'medium');
});

test('#5942 AC4.1: an implementer mapped to fast composes no --effort', async () => {
  const args = await composedArgs('implementer', 'model-effort: profile\nexpress-driver-models:\n  implementer: fast\n');
  assert.strictEqual(argEffort(args), null);
  assert.strictEqual(argModel(args), M('fast'));
});

test('#5942 AC8.1: an unknown effort in a model-profiles row refuses before any launch', async () => {
  const raw = 'model-effort: profile\nmodel-profiles:\n  standard:\n    effort: extreme\n';
  assert.match(modelPolicyRefusal(policyFrom(raw)), /implementer/);
  let launches = 0;
  let runs = 0;
  const shared = { activeWorker: null, policy: policyFrom(raw) };
  const deps = { platform: 'linux', env: {}, runner: () => { runs += 1; }, launchWorker: () => { launches += 1; } };
  await assert.rejects(() => launchTracked(shared, deps, { minutes: 1, dollars: 1 }, { role: 'implementer', prompt: 'p' }),
    (e) => e.code === MODEL_REFUSED_CODE);
  assert.deepStrictEqual([launches, runs, shared.activeWorker], [0, 0, null]);
});

test('#5942: launchTracked resolves { envelope, model, effort } and a throw carries err.effort', async () => {
  const opts = { role: 'implementer', prompt: 'p' };
  const limits = { minutes: 1, dollars: 1 };
  const boom = new Error('boom');
  for (const [raw, effort] of [['model-effort: profile\n', 'high'], ['', null]]) {
    const shared = { activeWorker: null, policy: policyFrom(raw) };
    const ok = await launchTracked(shared, { platform: 'linux', env: {}, runner: () => {}, launchWorker: async () => 'env' }, limits, opts);
    assert.deepStrictEqual(ok, { envelope: 'env', model: M('standard'), effort });
    const err = await launchTracked(shared, { platform: 'linux', env: {}, runner: () => {}, launchWorker: async () => { throw boom; } }, limits, opts).then(() => null, (e) => e);
    assert.strictEqual(err.effort, effort);
    assert.strictEqual(err.model, M('standard'));
  }
});

test('#5942: the resolved effort wins over an effort in the caller opts', async () => {
  const shared = { activeWorker: null, policy: policyFrom('') };
  let got = null;
  const deps = { platform: 'linux', env: {}, runner: () => {}, launchWorker: (o) => { got = o; } };
  await launchTracked(shared, deps, { minutes: 1, dollars: 1 }, { role: 'implementer', effort: 'max', prompt: 'p' });
  assert.strictEqual(got.effort, null);
});

test("#5942: model-ceiling standard clamps the reviewer's effort with its model", async () => {
  // A capable row of effort max, so a clamped (high) and an unclamped (max) effort differ.
  const args = await composedArgs('reviewer', 'model-effort: profile\nmodel-ceiling: standard\nmodel-profiles:\n  capable:\n    effort: max\n');
  const want = resolve(FOUR.reviewer, {
    policy: { 'model-effort': 'profile', 'model-ceiling': 'standard', 'model-profiles': { capable: { effort: 'max' } } },
    unattended: true,
  }).launchEffort;
  assert.strictEqual(argModel(args), M('standard'));
  assert.strictEqual(want, 'high');
  assert.strictEqual(argEffort(args), want);
});

test('#5942: an explorer under model-effort profile resolves resolve().launchEffort as its launch effort', () => {
  const policy = policyFrom('model-effort: profile\n');
  const want = resolve('standard', { policy: { 'model-effort': 'profile' }, unattended: true }).launchEffort;
  assert.strictEqual(typeof want, 'string');
  assert.strictEqual(roleLaunch('explorer', policy).effort, want);
});

test('AC3.2 (Q3): the lens-reviewer effort comes from its DRIVER_ROLE_PROFILES row', () => {
  assert.strictEqual(DRIVER_ROLE_PROFILES['lens-reviewer'], 'fast');
  for (const mode of ['profile', 'inherit']) {
    // A role map that omits lens-reviewer: the code-only row is what is read.
    const policy = { ...policyFrom(''), 'express-driver-models': { value: { ...FOUR }, source: 'policy' }, 'model-effort': { value: mode, source: 'policy' } };
    assert.deepStrictEqual(roleLaunch('lens-reviewer', policy), { model: 'haiku', effort: null }, mode);
  }
  assert.strictEqual(modelPolicyRefusal(policyFrom('')), null);
});

test('#5942: an invalid model-effort refuses every role', () => {
  const policy = policyFrom('model-effort: fancy\n');
  assert.strictEqual(policy['model-effort'].invalid, true);
  assert.strictEqual(modelPolicyRefusal(policy), 'driver model policy invalid: model-effort');
  assert.throws(() => roleLaunch('implementer', policy), refused('implementer', 'driver model policy invalid: model-effort'));
});

test('roleModel: a profile name that does not resolve reaches the refusal neutralized (one line, no mention)', () => {
  const policy = { 'express-driver-models': { value: { implementer: 'bad\nprofile @x' }, source: 'policy' } };
  assert.throws(() => roleModel('implementer', policy), (e) => e.code === MODEL_REFUSED_CODE && !e.message.includes('\n') && !e.message.includes(' @x'));
});
