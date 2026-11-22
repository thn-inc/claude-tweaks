'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const { sweepCli } = require('../../helpers/health-sweep-cli');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'docs-health.js');

// In-process (#5381), with the file-protocol-only git guard and a throwaway real cwd — see tests/helpers/health-sweep-cli.js.
function cli(argv, opts) {
  return sweepCli(CLI, argv, opts);
}

function makeTmpRoot() {
  return scratchDir('docs-health-cli-find-refs-');
}

test('find-refs reports zero for an orphan doc', () => {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  const target = path.join(root, 'docs', 'orphan.md');
  fs.writeFileSync(target, '# Orphan\n');
  const res = cli(['find-refs', target, '--root', root]);
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.result.count, 0);
});

test('find-refs reports a reference from README.md', () => {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  const target = path.join(root, 'docs', 'setup.md');
  fs.writeFileSync(target, '# Setup\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'See docs/setup.md.\n');
  const res = cli(['find-refs', target, '--root', root]);
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.result.count, 1);
});

test('find-refs exits 2 with no path argument', () => {
  const result = cli(['find-refs']);
  assert.strictEqual(result.status, 2);
});

test('find-refs exits 1 for a missing file', () => {
  const root = makeTmpRoot();
  const result = cli(['find-refs', path.join(root, 'docs', 'nope.md'), '--root', root]);
  assert.strictEqual(result.status, 1);
});

// Regression: cmdFindRefs checked fs.existsSync(targetPath) using the raw,
// unresolved targetPath instead of resolving it against --root the way
// deriveDocId's own path.resolve(root, targetPath) correctly does. A
// relative targetPath invoked from a cwd other than --root (the exact
// "audit a project elsewhere" scenario --root exists to support) failed
// with "could not read file" even though the file genuinely exists under
// --root.
test('find-refs resolves a relative path against --root, not the invoking cwd', () => {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'setup.md'), '# Setup\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'See docs/setup.md.\n');

  const elsewhere = scratchDir('docs-health-cli-find-refs-elsewhere-');
  const res = cli(['find-refs', 'docs/setup.md', '--root', root], { cwd: elsewhere });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.result.count, 1);
});

// ── in-process entry (#5381) ────────────────────────────────────────────────

// No --root at all: the root is the injected cwd, and a relative target path resolves under it.
test('AC8.1: find-refs without --root resolves a relative path under the injected cwd', () => {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'setup.md'), '# Setup\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'See docs/setup.md.\n');

  const res = cli(['find-refs', 'docs/setup.md'], { cwd: root });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  assert.strictEqual(JSON.parse(res.stdout).result.count, 1);
});
