'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { fixtureHomeEnv } = require('./helpers/fixture-home');

test('fixtureHomeEnv sets HOME and USERPROFILE to the fixture home and drops CLAUDE_CONFIG_DIR', () => {
  const base = { PATH: '/bin', HOME: '/real', USERPROFILE: 'C:\\Users\\real', CLAUDE_CONFIG_DIR: '/real/.claude-x' };
  const env = fixtureHomeEnv('/fx', base);
  assert.deepStrictEqual(env, { PATH: '/bin', HOME: '/fx', USERPROFILE: '/fx' });
  assert.strictEqual(base.CLAUDE_CONFIG_DIR, '/real/.claude-x', 'base is not mutated');
});

test('fixtureHomeEnv defaults its base to process.env', () => {
  const env = fixtureHomeEnv('/fx');
  assert.strictEqual(env.PATH, process.env.PATH);
  assert.strictEqual(env.USERPROFILE, '/fx');
  assert.ok(!('CLAUDE_CONFIG_DIR' in env));
});
