'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { git, makeOriginRepo, cloneOf } = require('./commit-fixtures');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'docs-health.js');

test('verify-commit exits 2 with no hash argument', () => {
  const r = spawnSync('node', [CLI, 'verify-commit'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: docs-health\.js verify-commit/);
});

test('verify-commit prints the result envelope for reachable and exists-unreachable hashes', () => {
  const origin = makeOriginRepo();
  const out = execFileSync('node', [
    CLI, 'verify-commit', origin.root.slice(0, 7), origin.sideOnly,
    '--root', origin.dir, '--integration-branch', 'main',
  ], { encoding: 'utf8' });
  const { result } = JSON.parse(out);
  assert.strictEqual(result.integrationRef, 'refs/heads/main');
  assert.deepStrictEqual(result.commits.map((c) => c.outcome), ['reachable', 'exists-unreachable']);
});

test('verify-commit --no-deepen on a shallow clone reports unverifiable and leaves it shallow', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const out = execFileSync('node', [CLI, 'verify-commit', origin.root, '--root', dir, '--no-deepen'], { encoding: 'utf8' });
  const { result } = JSON.parse(out);
  assert.deepStrictEqual(result.commits.map((c) => c.outcome), ['unverifiable']);
  assert.strictEqual(git(dir, ['rev-parse', '--is-shallow-repository']).trim(), 'true');
});

test('verify-commit on a shallow clone deepens by default and classifies', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const out = execFileSync('node', [CLI, 'verify-commit', origin.root, '--root', dir, '--remote', 'origin'], { encoding: 'utf8' });
  const { result } = JSON.parse(out);
  assert.strictEqual(result.shallow.deepened, true);
  assert.deepStrictEqual(result.commits.map((c) => c.outcome), ['reachable']);
});

test('the no-argument usage line names verify-commit', () => {
  const r = spawnSync('node', [CLI], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /verify-commit <sha>\.\.\./);
});
