'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveAcceptanceTarget, TARGETS, REASONS } = require('../../../plugin/bin/lib/accept/target');

const LOCAL_INVALID = { target: 'local', reason: 'invalid-input' };

test('exports the target and reason vocabularies', () => {
  assert.deepStrictEqual(TARGETS, ['local', 'dev']);
  assert.deepStrictEqual(REASONS, ['risk-flag', 'item-override', 'policy', 'default', 'invalid-input']);
});

test('AC1.1: kept flag beats a dev override and a dev default', () => {
  assert.deepStrictEqual(
    resolveAcceptanceTarget({ keptRiskFlags: ['auth'], itemOverride: 'dev', policyDefault: 'dev' }),
    { target: 'local', reason: 'risk-flag' });
});

test('AC1.2: no flag, local override, dev default → item-override', () => {
  assert.deepStrictEqual(
    resolveAcceptanceTarget({ keptRiskFlags: [], itemOverride: 'local', policyDefault: 'dev' }),
    { target: 'local', reason: 'item-override' });
});

test('AC1.3: neither → follows policy', () => {
  assert.deepStrictEqual(resolveAcceptanceTarget({ keptRiskFlags: [], policyDefault: 'dev' }),
    { target: 'dev', reason: 'policy' });
  assert.deepStrictEqual(resolveAcceptanceTarget({ keptRiskFlags: [], policyDefault: 'local' }),
    { target: 'local', reason: 'policy' });
});

test('AC1.4: nothing set → local by default', () => {
  assert.deepStrictEqual(resolveAcceptanceTarget({ keptRiskFlags: [] }), { target: 'local', reason: 'default' });
});

test('AC2.1: every invalid override resolves invalid-input', () => {
  for (const itemOverride of ['dev', 'staging', '', null]) {
    assert.deepStrictEqual(
      resolveAcceptanceTarget({ keptRiskFlags: [], itemOverride, policyDefault: 'dev' }),
      LOCAL_INVALID, JSON.stringify(itemOverride));
  }
});

test('AC2.2: every unreadable flag list resolves invalid-input', () => {
  for (const keptRiskFlags of [null, undefined, 'auth', ['auth', 3], [{}]]) {
    assert.deepStrictEqual(resolveAcceptanceTarget({ keptRiskFlags, policyDefault: 'dev' }),
      LOCAL_INVALID, JSON.stringify(keptRiskFlags));
  }
});

test('AC2.3: invalid policy default resolves invalid-input', () => {
  for (const policyDefault of ['staging', 42]) {
    assert.deepStrictEqual(resolveAcceptanceTarget({ keptRiskFlags: [], policyDefault }),
      LOCAL_INVALID, String(policyDefault));
  }
});

test('AC2.4: absent policy default, no flags, no override → default', () => {
  assert.deepStrictEqual(resolveAcceptanceTarget({ keptRiskFlags: [] }), { target: 'local', reason: 'default' });
});

test('AC2.5: a well-formed dev override never yields dev', () => {
  const r = resolveAcceptanceTarget({ keptRiskFlags: [], itemOverride: 'dev', policyDefault: 'local' });
  assert.strictEqual(r.target, 'local');
  assert.strictEqual(r.reason, 'invalid-input');
});

test('no argument at all fails closed to local', () => {
  assert.deepStrictEqual(resolveAcceptanceTarget(), LOCAL_INVALID);
});

test('a null or non-object input fails closed instead of throwing', () => {
  for (const input of [null, 'dev', 42, true]) {
    assert.deepStrictEqual(resolveAcceptanceTarget(input), LOCAL_INVALID, String(input));
  }
});

test('never dev without an affirmative dev default', () => {
  const flags = [[], ['auth'], null, undefined, 'auth', ['auth', 3]];
  const overrides = [undefined, 'local', 'dev', 'staging', '', null];
  const defaults = [undefined, 'local', 'dev', 'staging', 42, null];
  for (const keptRiskFlags of flags) {
    for (const itemOverride of overrides) {
      for (const policyDefault of defaults) {
        const r = resolveAcceptanceTarget({ keptRiskFlags, itemOverride, policyDefault });
        assert.ok(TARGETS.includes(r.target) && REASONS.includes(r.reason));
        if (r.target === 'dev') {
          assert.strictEqual(policyDefault, 'dev');
          assert.ok(Array.isArray(keptRiskFlags) && keptRiskFlags.length === 0);
          assert.strictEqual(itemOverride, undefined);
        }
      }
    }
  }
});
