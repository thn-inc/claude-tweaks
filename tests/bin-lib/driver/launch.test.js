'use strict';
// roleModel / modelPolicyRefusal: one driver role's model from the resolved policy (#5917).
// Fixtures come from the real policy resolvers, not hand-built entries.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const lib = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { roleModel, modelPolicyRefusal, MODEL_POLICY_KEYS, MODEL_REFUSED_CODE } = require(path.join(lib, 'driver', 'launch'));
const { DRIVER_ROLE_PROFILES } = require(path.join(lib, 'driver', 'roles'));
const { PROFILES } = require(path.join(lib, 'model-profiles', 'profiles'));
const { resolvePolicyKeys } = require(path.join(lib, 'policy-schema'));
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
