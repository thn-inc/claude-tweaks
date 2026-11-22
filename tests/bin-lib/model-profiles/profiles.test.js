// tests/bin-lib/model-profiles/profiles.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { PROFILES, EFFORT_SCALE, POLICY_KEYS_READ, effortLine } = require('../../../plugin/bin/lib/model-profiles/profiles');

test('PROFILES carries the four canonical rows with family-alias models', () => {
  assert.deepStrictEqual(Object.keys(PROFILES), ['fast', 'standard', 'capable', 'frontier']);
  assert.deepStrictEqual(PROFILES.fast, { model: 'haiku', effort: null });
  assert.deepStrictEqual(PROFILES.standard, { model: 'sonnet', effort: 'high' });
  assert.deepStrictEqual(PROFILES.capable, { model: 'opus', effort: 'high' });
  assert.deepStrictEqual(PROFILES.frontier, {
    model: 'fable', effort: 'high', singletonOnly: true, degradeTo: 'capable',
  });
});

test('EFFORT_SCALE is the ordered five-level ladder', () => {
  assert.deepStrictEqual(EFFORT_SCALE, ['low', 'medium', 'high', 'xhigh', 'max']);
});

test('POLICY_KEYS_READ names exactly the five policy keys', () => {
  assert.deepStrictEqual(POLICY_KEYS_READ,
    ['model-profiles', 'model-stance', 'model-ceiling', 'frontier-run-cap', 'model-effort']);
});

test('effortLine renders the pinned template, empty for null', () => {
  assert.strictEqual(effortLine('high'),
    '[Effort: high — apply high-level reasoning depth to this task.]');
  assert.strictEqual(effortLine(null), '');
});
