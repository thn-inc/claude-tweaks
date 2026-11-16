'use strict';
// #4620 Task 1: control mode composes into the autonomy ceiling through one helper.
// Every policy entry comes from a real resolvePolicyKeys reply, never a hand-written one.
const { test } = require('node:test');
const assert = require('node:assert');
const { resolvePolicyKeys } = require('../../../plugin/bin/lib/policy-schema');
const { effectiveCeiling, bookkeepingPermissions, resolveCeiling } = require('../../../plugin/bin/lib/issues/autonomy');

const eff = (policyRaw, runConfigRaw = null) => {
  const r = resolvePolicyKeys(['autonomy', 'control-mode'], { policyRaw, runConfigRaw });
  return effectiveCeiling({ autonomyEntry: r.autonomy, controlModeEntry: r['control-mode'] });
};

test('AC4.10: control-mode on alone gives the unattended capability set', () => {
  const e = eff('control-mode: on\n');
  assert.deepStrictEqual(e, { ceiling: 'unattended', controlMode: true, source: 'control-mode' });
  assert.deepStrictEqual(bookkeepingPermissions(e.ceiling), bookkeepingPermissions('unattended'));
});

test('AC4.11: control-mode on with explicit autonomy supervised gives supervised capabilities', () => {
  const e = eff('control-mode: on\nautonomy: supervised\n');
  assert.deepStrictEqual(e, { ceiling: 'supervised', controlMode: true, source: 'explicit' });
  assert.deepStrictEqual(bookkeepingPermissions(e.ceiling), bookkeepingPermissions('supervised'));
});

test('AC4.12: control-mode on with explicit autonomy trusted gives trusted capabilities', () => {
  const e = eff('control-mode: on\nautonomy: trusted\n');
  assert.deepStrictEqual(e, { ceiling: 'trusted', controlMode: true, source: 'explicit' });
  assert.deepStrictEqual(bookkeepingPermissions(e.ceiling), bookkeepingPermissions('trusted'));
});

test('AC4.13: control-mode off is unchanged', () => {
  for (const policy of ['', 'control-mode: off\n', 'autonomy: trusted\n', 'autonomy: unattended\ncontrol-mode: off\n']) {
    const e = eff(policy);
    assert.strictEqual(e.ceiling, resolveCeiling({ runConfig: /autonomy: (\w+)/.exec(policy)?.[1] }), policy);
    assert.strictEqual(e.controlMode, false, policy);
  }
});

test('AC4.11: a run-config autonomy beats a policy.yml control-mode', () => {
  const e = eff('control-mode: on\n', 'autonomy: supervised\n');
  assert.deepStrictEqual(e, { ceiling: 'supervised', controlMode: true, source: 'explicit' });
});

test('invalid autonomy with control mode on resolves supervised, never the implication', () => {
  const e = eff('control-mode: on\nautonomy: supervsed\n');
  assert.deepStrictEqual(e, { ceiling: 'supervised', controlMode: true, source: 'invalid-autonomy' });
});

test('a CLI arg wins over everything and reports source cli', () => {
  const r = resolvePolicyKeys(['autonomy', 'control-mode'], { policyRaw: 'control-mode: on\n', runConfigRaw: null });
  const e = effectiveCeiling({ cliArg: 'trusted', autonomyEntry: r.autonomy, controlModeEntry: r['control-mode'] });
  assert.deepStrictEqual(e, { ceiling: 'trusted', controlMode: true, source: 'cli' });
});

test('an errored entry counts as absent', () => {
  const e = effectiveCeiling({ autonomyEntry: { error: 'boom' }, controlModeEntry: { value: 'on', source: 'policy' } });
  assert.deepStrictEqual(e, { ceiling: 'unattended', controlMode: true, source: 'control-mode' });
  const off = effectiveCeiling({ autonomyEntry: { value: 'unattended', source: 'policy' }, controlModeEntry: { error: 'boom' } });
  assert.deepStrictEqual(off, { ceiling: 'unattended', controlMode: false, source: 'explicit' });
});

test('bookkeepingPermissions(ceiling, { controlMode }) composes for a missing ceiling only', () => {
  assert.deepStrictEqual(bookkeepingPermissions(null, { controlMode: true }), bookkeepingPermissions('unattended'));
  assert.deepStrictEqual(bookkeepingPermissions('supervised', { controlMode: true }), bookkeepingPermissions('supervised'));
  assert.deepStrictEqual(bookkeepingPermissions(undefined, {}), bookkeepingPermissions('supervised'));
  assert.deepStrictEqual(bookkeepingPermissions('bogus'), bookkeepingPermissions('supervised'));
});

test('resolveCeiling: controlMode sits below every explicit source', () => {
  assert.strictEqual(resolveCeiling({ controlMode: true }), 'unattended');
  assert.strictEqual(resolveCeiling({ policy: 'trusted', controlMode: true }), 'trusted');
  assert.strictEqual(resolveCeiling({ cliArg: 'bogus', controlMode: true }), 'unattended');
  assert.strictEqual(resolveCeiling({ controlMode: 'on' }), 'supervised');
  assert.strictEqual(resolveCeiling({}), 'supervised');
});

test('an unrecognized ceiling stays supervised under control mode; only an absent one lifts to unattended', () => {
  assert.deepStrictEqual(bookkeepingPermissions('supervsed', { controlMode: true }), bookkeepingPermissions('supervised'));
  assert.deepStrictEqual(bookkeepingPermissions(undefined, { controlMode: true }), bookkeepingPermissions('unattended'));
});
