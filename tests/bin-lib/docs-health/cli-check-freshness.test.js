'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { sweepCli } = require('../../helpers/health-sweep-cli');
const { cleanGitEnv, writeIdentity } = require('../../helpers/git-fixtures');
const { seedDurableState } = require('../health-core/seed-durable-state');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'docs-health.js');

// In-process (#5381), with the file-protocol-only git guard and a throwaway real cwd — see tests/helpers/health-sweep-cli.js.
function cli(argv, opts) {
  return sweepCli(CLI, argv, opts);
}

const GIT_OPTS = { env: cleanGitEnv(process.env) };

function makeTmpRoot() {
  return scratchDir('docs-health-cli-check-freshness-plain-');
}

function makeTmpGitRoot() {
  const root = scratchDir('docs-health-cli-check-freshness-');
  execFileSync('git', ['init', '-q'], { cwd: root, ...GIT_OPTS });
  writeIdentity(root, { name: 'Test', email: 'test@example.com' });
  return root;
}

test('check-freshness reports a missing tracked path', () => {
  const root = makeTmpGitRoot();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  const target = path.join(root, 'docs', 'tracked.md');
  fs.writeFileSync(target, '---\nfiles:\n  - src/nope.ts\n---\n\n# Doc\n');
  const res = cli(['check-freshness', target, '--root', root]);
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.deepStrictEqual(parsed.result.missing, ['src/nope.ts']);
});

test('check-freshness reports no staleness with no prior audit cursor', () => {
  const root = makeTmpGitRoot();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const x = 1;\n');
  execFileSync('git', ['add', 'src/a.ts'], { cwd: root, ...GIT_OPTS });
  execFileSync('git', ['commit', '-q', '-m', 'add a.ts'], { cwd: root, ...GIT_OPTS });
  const target = path.join(root, 'docs', 'tracked.md');
  fs.writeFileSync(target, '---\nfiles:\n  - src/a.ts\n---\n\n# Doc\n');
  const res = cli(['check-freshness', target, '--root', root]);
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.deepStrictEqual(parsed.result.stale, []);
});

test('check-freshness exits 2 with no path argument', () => {
  const result = cli(['check-freshness']);
  assert.strictEqual(result.status, 2);
});

test('check-freshness exits 1 for a missing file', () => {
  const root = makeTmpGitRoot();
  const result = cli(['check-freshness', path.join(root, 'docs', 'nope.md'), '--root', root]);
  assert.strictEqual(result.status, 1);
});

// Regression: cmdCheckFreshness read fs.readFileSync(targetPath, 'utf8')
// using the raw, unresolved targetPath instead of resolving it against
// --root the way deriveDocId's own path.resolve(root, targetPath) correctly
// does. A relative targetPath invoked from a cwd other than --root (the
// exact "audit a project elsewhere" scenario --root exists to support)
// failed with "could not read file" even though the file genuinely exists
// under --root.
test('check-freshness resolves a relative path against --root, not the invoking cwd', () => {
  const root = makeTmpGitRoot();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'tracked.md'), '---\nfiles:\n  - src/nope.ts\n---\n\n# Doc\n');

  const elsewhere = scratchDir('docs-health-cli-check-freshness-elsewhere-');
  const res = cli(['check-freshness', 'docs/tracked.md', '--root', root], { cwd: elsewhere });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.deepStrictEqual(parsed.result.missing, ['src/nope.ts']);
});

// ── in-process entry (#5381) ────────────────────────────────────────────────

// No --root at all: the root is the injected cwd, and a relative target path resolves under it.
test('AC8.1: check-freshness without --root resolves a relative path under the injected cwd', () => {
  const root = makeTmpGitRoot();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'tracked.md'), '---\nfiles:\n  - src/nope.ts\n---\n\n# Doc\n');

  const res = cli(['check-freshness', 'docs/tracked.md'], { cwd: root });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  assert.deepStrictEqual(JSON.parse(res.stdout).result.missing, ['src/nope.ts']);
});

// env-only fixture: the cursor (readDurableState's fetch) and the tracked file's `git log` both run
// under the injected env, so a GIT_DIR that only the injected env carries points them at repo B
// (whose health-state holds the cursor and whose history touches src/a.ts) although --root itself is
// not a repo. Without the injected GIT_DIR the file is never reported stale.
test('check-freshness reads cursor and history through the injected env: GIT_DIR names the repo, root is not one', () => {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, 'docs', 'tracked.md'), '---\nfiles:\n  - src/a.ts\n---\n\n# Doc\n');

  const repo = makeTmpGitRoot();
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const x = 2;\n');
  execFileSync('git', ['add', 'src/a.ts'], { cwd: repo, ...GIT_OPTS });
  execFileSync('git', ['commit', '-q', '-m', 'add a.ts'], { cwd: repo, ...GIT_OPTS });
  seedDurableState(repo, 'docs-health', 'cursors.json', { 'doc:tracked': { lastAuditedMs: 0 } }, 'docs-health-cf-env');

  const control = cli(['check-freshness', 'docs/tracked.md', '--root', root]);
  assert.strictEqual(control.status, 0, `stderr: ${control.stderr}`);
  assert.deepStrictEqual(JSON.parse(control.stdout).result.stale, [], 'no injected GIT_DIR: nothing can be reported stale');

  const res = cli(['check-freshness', 'docs/tracked.md', '--root', root], { env: { GIT_DIR: path.join(repo, '.git') } });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const { stale } = JSON.parse(res.stdout).result;
  assert.deepStrictEqual(stale.map((s) => s.path), ['src/a.ts']);
});
