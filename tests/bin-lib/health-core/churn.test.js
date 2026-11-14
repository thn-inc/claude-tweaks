'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { domainChurn } = require('../../../plugin/bin/lib/health-core/churn');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'health-core-churn-')); }

function initGitRepo(root) {
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@test.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);
}

function commit(root, msg) {
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', msg]);
}

test('domainChurn returns 0 for an empty path list', () => {
  const root = tmp();
  assert.strictEqual(domainChurn(root, [], 0), 0);
});

test('domainChurn returns 0 when git is unavailable (bad root)', () => {
  assert.strictEqual(domainChurn('/nonexistent/path/xyz', ['a.js'], 0), 0);
});

test('domainChurn counts commits touching the given paths since sinceMs', () => {
  const root = tmp();
  initGitRepo(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 1;\n');
  commit(root, 'first');
  const sinceMs = Date.now() - 86400000;
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 2;\n');
  commit(root, 'second');
  const churn = domainChurn(root, ['src/a.js'], sinceMs);
  assert.ok(churn >= 1, 'must count the commit touching src/a.js');
});

test('domainChurn(root, paths, 0) counts a commit from well in the past (epoch-boundary regression)', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'b.ts'), '', 'utf8');
  initGitRepo(root);
  execFileSync('git', ['-C', root, 'add', '.']);
  const backdated = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'init'], {
    env: { ...process.env, GIT_AUTHOR_DATE: backdated, GIT_COMMITTER_DATE: backdated },
  });
  const count = domainChurn(root, ['src/b.ts'], 0);
  assert.ok(count > 0, `expected the backdated commit to be counted since sinceMs=0, got ${count}`);
});

test('domainChurn caches identical (root, paths, sinceMs) calls instead of re-spawning git', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), '', 'utf8');
  initGitRepo(root);
  execFileSync('git', ['-C', root, 'add', '.']);
  commit(root, 'init');

  const first = domainChurn(root, ['src/a.ts'], 0);
  assert.ok(first > 0);

  // Remove .git so a second, uncached call would fall through to the
  // execFileSync catch block and silently return 0 — proves the second call
  // below is served from the cache, not a fresh `git log` subprocess.
  fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
  const second = domainChurn(root, ['src/a.ts'], 0);
  assert.strictEqual(second, first);
});

test('domainChurn runs git with the injected env', () => {
  const B = tmp();
  fs.writeFileSync(path.join(B, 'a.md'), 'x\n');
  initGitRepo(B);
  commit(B, 'first');
  const notARepo = tmp();
  // GIT_DIR points git at B's repository even though `-C` names a non-repo
  // directory; the count is 0 when the injected env is ignored.
  const env = { ...process.env, GIT_DIR: path.join(B, '.git') };
  assert.strictEqual(domainChurn(notARepo, ['a.md'], 0, { env }), 1);
});

// Regression: this module is required by all three health-sibling scope.js
// files (harness-health, journey-health, docs-health) — previously each had
// its own copy of domainChurn (and, for harness-health/docs-health, no
// caching at all). A shared, single-source module means a fix here reaches
// every caller, and the cache is legitimately shared across callers since
// domainChurn's result depends only on (root, relPaths, sinceMs), never on
// which caller asked.
test('domainChurn is a single shared cache across every consumer scope.js', () => {
  const harnessScope = require('../../../plugin/bin/lib/harness-health/scope');
  const journeyScope = require('../../../plugin/bin/lib/journey-health/scope');
  const docsScope = require('../../../plugin/bin/lib/docs-health/scope');
  assert.strictEqual(harnessScope.domainChurn, domainChurn);
  assert.strictEqual(journeyScope.domainChurn, domainChurn);
  assert.strictEqual(docsScope.domainChurn, domainChurn);
});
