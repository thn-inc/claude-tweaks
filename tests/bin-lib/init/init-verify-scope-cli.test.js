// tests/bin-lib/init/init-verify-scope-cli.test.js — plugin/bin/init-verify-scope.js
// (#1924), the thin CLI over plugin/bin/lib/init/verify-scope-starter.js. No
// deps seam (this CLI shells out to nothing but fs), so these tests spawn
// the real binary against real temp dirs under os.tmpdir(), never this
// checkout, and assert on exit code, stdout, and file side effects.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'init-verify-scope.js');
const { readDeclaration } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'declaration.js'));

// spawnSync (not execFileSync) so stderr is captured on a clean exit too — a
// warning line can print on stderr alongside exit 0 (A5).
function runCli(args) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function tmpRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('(a) single-package root, no --write: --json reports written:false, existed:false, checks.tests is the root test script', () => {
  const root = tmpRoot('ivs-single-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'proj', scripts: { test: 'node --test' } }));

  const res = runCli(['--root', root, '--json']);
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.written, false);
  assert.strictEqual(out.existed, false);
  assert.strictEqual(out.declaration.checks.tests, 'node --test');
  assert.strictEqual(out.path, path.join(root, '.claude-tweaks', 'verify-scope.json'));
  assert.ok(!fs.existsSync(out.path), 'no --write must never create the file');
});

test('(b) --write creates a readDeclaration-valid file; a second --write leaves mtime unchanged (AC3) and reports exists/existed:true', async () => {
  const root = tmpRoot('ivs-write-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'proj', scripts: { test: 'node --test' } }));
  const targetPath = path.join(root, '.claude-tweaks', 'verify-scope.json');

  const first = runCli(['--root', root, '--write']);
  assert.strictEqual(first.status, 0, first.stderr);
  assert.match(first.stdout, /^written: /m);
  assert.ok(fs.existsSync(targetPath), 'file must exist after --write');
  const parsed = readDeclaration(targetPath);
  assert.strictEqual(parsed.ok, true, JSON.stringify(parsed.errors));

  const firstMtimeMs = fs.statSync(targetPath).mtimeMs;
  await new Promise((r) => { setTimeout(r, 25); });

  const second = runCli(['--root', root, '--write']);
  assert.strictEqual(second.status, 0, second.stderr);
  assert.match(second.stdout, /^exists: /m);
  assert.match(second.stdout, new RegExp(`exists: ${targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(left unchanged\\)`));

  const secondJson = runCli(['--root', root, '--write', '--json']);
  assert.strictEqual(secondJson.status, 0, secondJson.stderr);
  assert.strictEqual(JSON.parse(secondJson.stdout).existed, true);

  assert.strictEqual(fs.statSync(targetPath).mtimeMs, firstMtimeMs, 'a second --write must never touch an existing file (AC3)');
});

test('(c) --root /nonexistent: exit 2, usage on stderr', () => {
  const res = runCli(['--root', '/nonexistent-path-for-init-verify-scope-test']);
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /usage:/);
});

test('(d) unknown flag: exit 2, usage on stderr', () => {
  const root = tmpRoot('ivs-badflag-');
  const res = runCli(['--root', root, '--bogus']);
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /usage:/);
});

test('(e) a package.json with no name produces a `warning: skipped` line on stderr (A5)', () => {
  const root = tmpRoot('ivs-skip-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'proj', workspaces: ['packages/*'] }));
  fs.mkdirSync(path.join(root, 'packages', 'noname'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'noname', 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

  const res = runCli(['--root', root]);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stderr, /warning: skipped packages\/noname — package\.json has no name/);
});

test('(f) --drift: a hand-written declaration naming suite `legacy` vs a workspace with `api` reports extra/missing (A6)', () => {
  const root = tmpRoot('ivs-drift-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'proj', workspaces: ['apps/*'] }));
  fs.mkdirSync(path.join(root, 'apps', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'api', 'package.json'), JSON.stringify({ name: 'api', scripts: { test: 'jest' } }));
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'verify-scope.json'), JSON.stringify({
    checks: { tests: { legacy: 'jest' } },
    rules: [{ match: 'apps/**', suites: ['legacy'], static: true }],
  }));

  const res = runCli(['--root', root, '--drift', '--json']);
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.declared, true);
  assert.deepStrictEqual(out.extraSuites, ['legacy']);
  assert.deepStrictEqual(out.missingSuites, ['api']);

  const text = runCli(['--root', root, '--drift']);
  assert.strictEqual(text.status, 0, text.stderr);
  assert.match(text.stdout, /drift: suites legacy not in workspace; packages api have no suite/);
});

test('(g) --drift with no declaration: declared:false, exit 0 (A6)', () => {
  const root = tmpRoot('ivs-nodecl-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'proj' }));

  const jsonRes = runCli(['--root', root, '--drift', '--json']);
  assert.strictEqual(jsonRes.status, 0, jsonRes.stderr);
  assert.deepStrictEqual(JSON.parse(jsonRes.stdout), { declared: false });

  const textRes = runCli(['--root', root, '--drift']);
  assert.strictEqual(textRes.status, 0, textRes.stderr);
  assert.match(textRes.stdout, /^no declaration at /);
});

test('(h) --drift with --write is a usage error, exit 2 (A6)', () => {
  const root = tmpRoot('ivs-driftwrite-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'proj' }));
  const res = runCli(['--root', root, '--drift', '--write']);
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /usage:/);
});

test('(i) --root value beginning with -- is a usage error, exit 2 (A7)', () => {
  const res = runCli(['--root', '--bogus']);
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /--root requires a directory value/);
});
