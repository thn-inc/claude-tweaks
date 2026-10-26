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
  // Compare by each key's own stored name: win32's process.env is a
  // case-insensitive proxy ('Path'), but the spread copy is a plain object.
  const replaced = new Set(['HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR']);
  for (const k of Object.keys(process.env)) {
    if (replaced.has(k.toUpperCase())) continue;
    assert.strictEqual(env[k], process.env[k], `${k} is carried over from process.env`);
  }
  assert.strictEqual(env.USERPROFILE, '/fx');
  assert.ok(!('CLAUDE_CONFIG_DIR' in env));
});
