'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'diff-facts.js');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function runCli(cwd, args) {
  return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
}

const fixtureDirs = [];
test.after(() => {
  fixtureDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

function initRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fixtureDirs.push(dir);
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  return dir;
}

// Fixture: a main branch with base.txt, then a feature branch adding one
// implementation file (3 lines), one test file (1 line) and one docs file
// (2 lines), all committed. `withImpl: false` drops the implementation file.
function makeFixtureRepo({ withImpl = true } = {}) {
  const dir = initRepo('diff-facts-');
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'base');
  git(dir, 'checkout', '-b', 'feature');
  if (withImpl) fs.writeFileSync(path.join(dir, 'impl.js'), 'x\ny\nz\n');
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'impl.test.js'), 'a\n');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'notes.md'), 'one\ntwo\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'feature work');
  return dir;
}

test('AC1.1: --integration-branch main prints the diff-facts JSON', () => {
  const dir = makeFixtureRepo();
  const res = runCli(dir, ['--integration-branch', 'main']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.deepStrictEqual(JSON.parse(res.stdout), {
    fileCount: 3, testFiles: 1, docsFiles: 1, implFiles: 1, totalLines: 6,
    testOnly: false, docsOnly: false, lowSurface: false,
  });
  assert.strictEqual(res.stderr, '');
});

test('a test-plus-docs diff is lowSurface', () => {
  const dir = makeFixtureRepo({ withImpl: false });
  const res = runCli(dir, ['--integration-branch', 'main']);
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.lowSurface, true);
  assert.strictEqual(out.implFiles, 0);
  assert.strictEqual(out.fileCount, 2);
});

test('uncommitted working-tree edits are not counted', () => {
  const dir = makeFixtureRepo();
  fs.appendFileSync(path.join(dir, 'impl.js'), 'uncommitted\n');
  const res = runCli(dir, ['--integration-branch', 'main']);
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.fileCount, 3);
  assert.strictEqual(out.totalLines, 6);
});

test('--base <sha> uses the given commit', () => {
  const dir = makeFixtureRepo();
  const baseSha = git(dir, 'rev-parse', 'main').trim();
  const viaBase = runCli(dir, ['--base', baseSha]);
  const viaBranch = runCli(dir, ['--integration-branch', 'main']);
  assert.strictEqual(viaBase.status, 0, viaBase.stderr);
  assert.deepStrictEqual(JSON.parse(viaBase.stdout), JSON.parse(viaBranch.stdout));
});

test('unresolvable integration branch exits 1 with stderr and NO stdout', () => {
  const dir = makeFixtureRepo();
  const res = runCli(dir, ['--integration-branch', 'no-such-branch']);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /^diff-facts: could not resolve merge base/);
  assert.strictEqual(res.stdout, '', 'a resolution failure must never print a summary');
});

test('missing flags exits 1 with usage', () => {
  const dir = makeFixtureRepo();
  const res = runCli(dir, []);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /usage: diff-facts\.js/);
  assert.strictEqual(res.stdout, '');
});

test('a trailing bare flag exits 1, never throws', () => {
  const dir = makeFixtureRepo();
  const res = runCli(dir, ['--integration-branch']);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /^diff-facts: --integration-branch requires a value/);
  assert.strictEqual(res.stdout, '');
});

test('a flag whose value is another flag exits 1 with requires-a-value, never a misparse', () => {
  const dir = makeFixtureRepo();
  const res = runCli(dir, ['--base', '--integration-branch', 'main']);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /^diff-facts: --base requires a value/);
  assert.strictEqual(res.stdout, '');
});

test('unknown flag exits 1', () => {
  const dir = makeFixtureRepo();
  const res = runCli(dir, ['--bogus', 'x']);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /^diff-facts: unknown argument: --bogus/);
  assert.strictEqual(res.stdout, '');
});

// A stale local `main` (behind a same-named origin/main remote-tracking ref),
// as in blast-radius-cli-e2e.test.js: `unrelated.txt` lands on main before
// `feature` branches, then local main is force-set back to the root commit.
function makeStaleLocalMainFixture() {
  const dir = initRepo('diff-facts-stale-');
  fs.writeFileSync(path.join(dir, 'root.txt'), 'root\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'root');
  const rootSha = git(dir, 'rev-parse', 'HEAD').trim();

  fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'unrelated\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'unrelated main work');
  const advancedSha = git(dir, 'rev-parse', 'HEAD').trim();

  git(dir, 'checkout', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'impl.js'), 'x\ny\nz\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'feature work');

  git(dir, 'update-ref', 'refs/remotes/origin/main', advancedSha);
  git(dir, 'branch', '-f', 'main', rootSha);
  return dir;
}

test('a stale local main resolves against origin/main, excluding unrelated already-landed commits', () => {
  const dir = makeStaleLocalMainFixture();
  const res = runCli(dir, ['--integration-branch', 'main']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(JSON.parse(res.stdout).fileCount, 1, 'unrelated.txt from the stale gap must not be counted');
});
