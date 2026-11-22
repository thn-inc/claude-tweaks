// tests/bin-lib/init/init-verify-scope-cli.test.js — plugin/bin/init-verify-scope.js
// (#1924), the thin CLI over plugin/bin/lib/init/verify-scope-starter.js. It
// shells out to nothing but fs, so these tests call its exported run in-process
// (#5385) against real temp dirs under os.tmpdir(), never this checkout, and
// assert on exit code, stdout, and file side effects. Two tests stay on a real
// process: the script entry's success path and its no-argument refusal.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'init-verify-scope.js');
const { readDeclaration } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'declaration.js'));

// stderr is captured on a clean exit too — a warning line can print on stderr
// alongside exit 0 (A5). Maps the helper's `code` onto the `status` the
// assertions below use.
function cli(args, opts = {}) {
  const { code, stdout, stderr } = runCliSync(CLI, args, opts);
  return { status: code, stdout, stderr };
}

function tmpRoot(prefix) {
  return scratchDir(prefix);
}

test('(a) single-package root, no --write: --json reports written:false, existed:false, checks.tests is the root test script', () => {
  const root = tmpRoot('ivs-single-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'proj', scripts: { test: 'node --test' } }));

  // Real process: proves the script entry (the require.main guard), exit 0 and JSON on stdout.
  const { code, stdout, stderr } = spawnCli(CLI, ['--root', root, '--json']);
  const res = { status: code, stdout, stderr };
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

  const first = cli(['--root', root, '--write']);
  assert.strictEqual(first.status, 0, first.stderr);
  assert.match(first.stdout, /^written: /m);
  assert.ok(fs.existsSync(targetPath), 'file must exist after --write');
  const parsed = readDeclaration(targetPath);
  assert.strictEqual(parsed.ok, true, JSON.stringify(parsed.errors));

  const firstMtimeMs = fs.statSync(targetPath).mtimeMs;
  await new Promise((r) => { setTimeout(r, 25); });

  const second = cli(['--root', root, '--write']);
  assert.strictEqual(second.status, 0, second.stderr);
  assert.match(second.stdout, /^exists: /m);
  assert.match(second.stdout, new RegExp(`exists: ${targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(left unchanged\\)`));

  const secondJson = cli(['--root', root, '--write', '--json']);
  assert.strictEqual(secondJson.status, 0, secondJson.stderr);
  assert.strictEqual(JSON.parse(secondJson.stdout).existed, true);

  assert.strictEqual(fs.statSync(targetPath).mtimeMs, firstMtimeMs, 'a second --write must never touch an existing file (AC3)');
});

test('(c) --root /nonexistent: exit 2, usage on stderr', () => {
  const res = cli(['--root', '/nonexistent-path-for-init-verify-scope-test']);
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /usage:/);
});

test('(d) unknown flag: exit 2, usage on stderr', () => {
  const root = tmpRoot('ivs-badflag-');
  const res = cli(['--root', root, '--bogus']);
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /usage:/);
});

test('(e) a package.json with no name produces a `warning: skipped` line on stderr (A5)', () => {
  const root = tmpRoot('ivs-skip-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'proj', workspaces: ['packages/*'] }));
  fs.mkdirSync(path.join(root, 'packages', 'noname'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'noname', 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

  const res = cli(['--root', root]);
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

  const res = cli(['--root', root, '--drift', '--json']);
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.declared, true);
  assert.deepStrictEqual(out.extraSuites, ['legacy']);
  assert.deepStrictEqual(out.missingSuites, ['api']);

  const text = cli(['--root', root, '--drift']);
  assert.strictEqual(text.status, 0, text.stderr);
  assert.match(text.stdout, /drift: suites legacy not in workspace; packages api have no suite/);
});

test('(g) --drift with no declaration: declared:false, exit 0 (A6)', () => {
  const root = tmpRoot('ivs-nodecl-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'proj' }));

  const jsonRes = cli(['--root', root, '--drift', '--json']);
  assert.strictEqual(jsonRes.status, 0, jsonRes.stderr);
  assert.deepStrictEqual(JSON.parse(jsonRes.stdout), { declared: false });

  const textRes = cli(['--root', root, '--drift']);
  assert.strictEqual(textRes.status, 0, textRes.stderr);
  assert.match(textRes.stdout, /^no declaration at /);
});

test('(h) --drift with --write is a usage error, exit 2 (A6)', () => {
  const root = tmpRoot('ivs-driftwrite-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'proj' }));
  const res = cli(['--root', root, '--drift', '--write']);
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /usage:/);
});

test('(i) --root value beginning with -- is a usage error, exit 2 (A7)', () => {
  const res = cli(['--root', '--bogus']);
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /--root requires a directory value/);
});

test('AC6.1: no arguments on a real process exits 2 with the --root usage on stderr and empty stdout', () => {
  // Real process: proves the script entry's exit code and stderr bytes when run with no arguments.
  const res = spawnCli(CLI, []);
  assert.strictEqual(res.code, 2);
  assert.strictEqual(res.stdout, '');
  assert.strictEqual(res.stderr, 'init-verify-scope.js: --root <dir> is required\nusage: init-verify-scope.js --root <dir> [--write | --drift] [--json]\n');
});

test('AC9.1: a relative --root resolves against the injected cwd', () => {
  const parent = tmpRoot('ivs-cwd-');
  assert.notStrictEqual(parent, process.cwd());
  fs.mkdirSync(path.join(parent, 'proj'));
  fs.writeFileSync(path.join(parent, 'proj', 'package.json'), JSON.stringify({ name: 'proj', scripts: { test: 'node --test' } }));

  const res = cli(['--root', 'proj', '--json'], { cwd: parent });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(JSON.parse(res.stdout).path, path.join(parent, 'proj', '.claude-tweaks', 'verify-scope.json'));
});

// A deleted working directory makes the real cwd() throw; an absolute --root never needed it.
test('an absolute --root succeeds with an unreadable cwd, as before the entry contract', () => {
  const root = tmpRoot('ivs-nocwd-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'proj', scripts: { test: 'node --test' } }));
  const expected = cli(['--root', root, '--json']);
  const res = cli(['--root', root, '--json'], {
    deps: { cwd: () => { throw Object.assign(new Error('ENOENT: process.cwd failed'), { code: 'ENOENT' }); } },
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stderr, '');
  assert.strictEqual(res.stdout, expected.stdout);
  assert.strictEqual(JSON.parse(res.stdout).path, path.join(root, '.claude-tweaks', 'verify-scope.json'));
});

test('(j) --drift with an unparseable declaration prints its errors on stderr and exits 1', () => {
  const root = tmpRoot('ivs-baddecl-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'proj' }));
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'verify-scope.json'), '{bad');

  const res = cli(['--root', root, '--drift']);
  assert.strictEqual(res.status, 1);
  assert.strictEqual(res.stdout, '');
  assert.match(res.stderr, /verify-scope\.json: could not parse JSON/);
});
