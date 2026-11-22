const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { CLI, REPO_ROOT } = require('./cli-helpers');

test('--base HEAD --no-suite runs and renders the Outstanding table', () => {
  const out = execFileSync('node', [CLI, '--base', 'HEAD', '--no-suite'], {
    cwd: REPO_ROOT, encoding: 'utf8',
  });
  assert.match(out, /^### Outstanding \(\d+\)/);
});

test('--base HEAD --no-suite --json prints a parseable {scope, results} shape', () => {
  const out = execFileSync('node', [CLI, '--base', 'HEAD', '--no-suite', '--json'], {
    cwd: REPO_ROOT, encoding: 'utf8',
  });
  const parsed = JSON.parse(out);
  assert.ok(parsed.scope && typeof parsed.scope === 'object', 'scope is an object');
  assert.ok(Array.isArray(parsed.results), 'results is an array');
  assert.ok(parsed.results.length > 0, 'at least one probe result present');
  for (const r of parsed.results) {
    assert.strictEqual(typeof r.ran, 'boolean', `result ${JSON.stringify(r).slice(0, 80)} carries a boolean ran field`);
  }
});
