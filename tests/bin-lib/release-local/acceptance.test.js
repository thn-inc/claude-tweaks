'use strict';
// Acceptance criteria 1, 2, 3, 5 and 7 against real git repos: the CLI is
// spawned as a user would run it. Fixture repos have no origin (local-merge's
// common case) unless a test adds one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitRepo, fixtureGit } = require('../../helpers/git-fixtures.js');
const { runCliSync, spawnCli } = require('../../helpers/run-cli.js');

const CLI = path.join(__dirname, '../../../plugin/bin/release-local.js');
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

const GIT_IDENT = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
// The whole environment an in-process call sees: no ambient GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE.
const ENV_PLAIN = {
  PATH: process.env.PATH, HOME: process.env.HOME,
  ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, USERPROFILE: process.env.USERPROFILE } : {}),
  ...GIT_IDENT,
};

function runCli(root, args = [], opts = {}) {
  return runCliSync(CLI, ['--root', root, ...args], { env: ENV_PLAIN, ...opts });
}

function commit(root, subject, files = {}) {
  for (const [p, text] of Object.entries(files)) fs.writeFileSync(path.join(root, p), text);
  fixtureGit(['-C', root, 'add', '-A'], { env: ENV });
  fixtureGit(['-C', root, 'commit', '-q', '--allow-empty', '-m', subject], { env: ENV });
}

function bootstrapped(version) {
  const root = gitRepo();
  fixtureGit(['-C', root, 'branch', '-M', 'main']);
  commit(root, 'chore: bootstrap', {
    'release-please-config.json': JSON.stringify({ packages: { '.': { 'release-type': 'node' } } }, null, 2) + '\n',
    '.release-please-manifest.json': `{\n  ".": "${version}"\n}\n`,
    'package.json': `{\n  "name": "fixture",\n  "version": "${version}",\n  "private": true\n}\n`,
    'CHANGELOG.md': '# Changelog\n',
  });
  return root;
}

// A bare repo wired up as `origin`, with `main` deliberately never pushed — the
// shape a project has on its very first release into a fresh remote (#2254 F6).
function bareOrigin(root) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-origin-')));
  fixtureGit(['init', '--bare', '-q', dir]);
  fixtureGit(['-C', root, 'remote', 'add', 'origin', dir]);
  return dir;
}

// A bootstrapped-but-untagged repo with that origin and a release-hook policy.
function withOriginAndHook() {
  const root = bootstrapped('1.2.0');
  bareOrigin(root);
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'release-hook: "touch hook-ran.txt"\n');
  commit(root, 'feat: one');
  return root;
}

const lsRemote = (root, kind, ref) => fixtureGit(['-C', root, 'ls-remote', kind, 'origin', ...(ref ? [ref] : [])]).toString();

function tagged(version) {
  const root = bootstrapped(version);
  fixtureGit(['-C', root, 'tag', '-a', `v${version}`, '-m', `v${version}`], { env: ENV });
  return root;
}

test('AC 1: v1.2.0 + fix, fix, feat → --dry-run reports 1.3.0, three bullets, no hook, writes nothing', () => {
  const root = tagged('1.2.0');
  commit(root, 'fix: one'); commit(root, 'fix: two'); commit(root, 'feat: three');
  const before = fixtureGit(['-C', root, 'rev-parse', 'HEAD']).toString();
  const r = runCli(root, ['--dry-run']);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /v1\.3\.0 \(minor\) from v1\.2\.0/);
  assert.strictEqual((r.stdout.match(/^\* /gm) || []).length, 3);
  assert.match(r.stdout, /no hook configured/);
  assert.strictEqual(fixtureGit(['-C', root, 'status', '--porcelain']).toString(), '');
  assert.strictEqual(fixtureGit(['-C', root, 'rev-parse', 'HEAD']).toString(), before);
  assert.strictEqual(fixtureGit(['-C', root, 'tag', '-l']).toString().trim(), 'v1.2.0');
});

test('AC 2: the live run lands the manifest edit, the CHANGELOG section, the chore(release) commit and the annotated tag', () => {
  const root = tagged('1.2.0');
  commit(root, 'fix: one'); commit(root, 'fix: two'); commit(root, 'feat: three');
  const r = runCli(root);
  assert.strictEqual(r.code, 0, r.stderr);
  // git 2.55 prints `v1.3.0^0` when HEAD is the tagged commit itself (probed 2026-09-12); the design doc's bare `v1.3.0` is the tag-name half.
  assert.match(fixtureGit(['-C', root, 'describe', '--contains', 'HEAD']).toString().trim(), /^v1\.3\.0(\^0)?$/);
  assert.strictEqual(fixtureGit(['-C', root, 'log', '-1', '--format=%s']).toString().trim(), 'chore(release): v1.3.0');
  assert.strictEqual(fixtureGit(['-C', root, 'cat-file', '-t', 'v1.3.0']).toString().trim(), 'tag');
  assert.strictEqual(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), '{\n  "name": "fixture",\n  "version": "1.3.0",\n  "private": true\n}\n');
  assert.strictEqual(fs.readFileSync(path.join(root, '.release-please-manifest.json'), 'utf8'), '{\n  ".": "1.3.0"\n}\n');
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /^# Changelog\n\n## 1\.3\.0 \(\d{4}-\d{2}-\d{2}\)\n\n\n### Features\n\n\* three\n\n\n### Bug Fixes\n\n\* two\n\* one\n$/);
  assert.strictEqual(fixtureGit(['-C', root, 'status', '--porcelain']).toString(), '');
});

test('AC 3: only chore commits since the tag → exit 3, nothing written', () => {
  const root = tagged('1.2.0');
  commit(root, 'chore: a'); commit(root, 'docs: b');
  const before = fixtureGit(['-C', root, 'rev-parse', 'HEAD']).toString();
  const r = runCli(root);
  assert.strictEqual(r.code, 3, r.stderr);
  assert.match(r.stdout, /nothing to release/);
  assert.strictEqual(fixtureGit(['-C', root, 'rev-parse', 'HEAD']).toString(), before);
  assert.strictEqual(fixtureGit(['-C', root, 'tag', '-l']).toString().trim(), 'v1.2.0');
  assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /"version": "1\.2\.0"/);
});

test('AC 5: a BREAKING CHANGE footer among fix/chore commits computes a major', () => {
  const root = tagged('1.2.0');
  commit(root, 'fix: a'); commit(root, 'chore: b');
  fixtureGit(['-C', root, 'commit', '-q', '--allow-empty', '-m', 'fix: rename key\n\nBREAKING CHANGE: config key renamed'], { env: ENV });
  const r = runCli(root, ['--dry-run']);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /v2\.0\.0 \(major\)/);
  assert.match(r.stdout, /### ⚠ BREAKING CHANGES\n\n\* config key renamed\n/);
});

test('#2327: v0.4.2 + a breaking commit → --dry-run proposes 0.5.0 (minor), not 1.0.0 — bump-minor-pre-major defaults true', () => {
  const root = tagged('0.4.2');
  fixtureGit(['-C', root, 'commit', '-q', '--allow-empty', '-m', 'feat!: drop the old flag'], { env: ENV });
  const r = runCli(root, ['--dry-run']);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /v0\.5\.0 \(minor\) from v0\.4\.2/);
});

test('#2327: bump-minor-pre-major: false in release-please-config.json restores the plain major bump on 0.x', () => {
  const root = tagged('0.4.2');
  const cfgPath = path.join(root, 'release-please-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ packages: { '.': { 'release-type': 'node', 'bump-minor-pre-major': false } } }, null, 2) + '\n');
  commit(root, 'chore: pin bump-minor-pre-major false');
  fixtureGit(['-C', root, 'commit', '-q', '--allow-empty', '-m', 'feat!: drop the old flag'], { env: ENV });
  const r = runCli(root, ['--dry-run']);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /v1\.0\.0 \(major\) from v0\.4\.2/);
});

test('AC 7: no prior v* tag → the full first-parent history, base from the seeded manifest: 0.1.0 + feat → 0.2.0', () => {
  const root = bootstrapped('0.1.0');
  commit(root, 'feat: first');
  const r = runCli(root, ['--dry-run']);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /v0\.2\.0 \(minor\) from no prior tag/);
});

test('origin exists but main was never pushed: the first release pushes branch + tag and runs the release-hook', () => {
  const root = withOriginAndHook();
  // real process: proves the script entry, the exit code and the real release-hook shell
  const r = spawnCli(CLI, ['--root', root], { env: { ...process.env, ...GIT_IDENT } });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /origin: main is not on origin yet — first push/);
  assert.match(r.stdout, /hook: touch hook-ran\.txt/);
  assert.match(lsRemote(root, '--tags'), /refs\/tags\/v1\.3\.0/);
  assert.match(lsRemote(root, '--heads', 'main'), /refs\/heads\/main/);
  assert.ok(fs.existsSync(path.join(root, 'hook-ran.txt')), 'the release-hook must run after the push');
  assert.strictEqual(fixtureGit(['-C', root, 'status', '--porcelain', '--untracked-files=no']).toString(), '');
});

test('a second release on the same repo advances both refs on the remote (the ancestry-checked path)', () => {
  const root = withOriginAndHook();
  assert.strictEqual(runCli(root, [], { allowRealRunner: true }).code, 0);
  commit(root, 'fix: two');
  const r = runCli(root, [], { allowRealRunner: true });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.ok(!r.stdout.includes('is not on origin yet'), r.stdout);
  const head = fixtureGit(['-C', root, 'rev-parse', 'HEAD']).toString().trim();
  assert.strictEqual(lsRemote(root, '--heads', 'main').split('\t')[0], head);
  const tags = lsRemote(root, '--tags');
  assert.match(tags, /refs\/tags\/v1\.3\.0/);
  assert.match(tags, /refs\/tags\/v1\.3\.1/);
});

test('a first-parent merge keeps branch commits out of the plan (design stance 3)', () => {
  const root = tagged('1.2.0');
  fixtureGit(['-C', root, 'checkout', '-q', '-b', 'feature']);
  commit(root, 'wip: branch noise'); commit(root, 'feat!: branch-only breaking');
  fixtureGit(['-C', root, 'checkout', '-q', 'main']);
  fixtureGit(['-C', root, 'merge', '-q', '--no-ff', '-m', 'fix: merged feature', 'feature'], { env: ENV });
  const r = runCli(root, ['--dry-run']);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /v1\.2\.1 \(patch\)/);
  assert.ok(!r.stdout.includes('branch-only breaking'));
  assert.ok(!r.stdout.includes('unconventional'));
});

test('--root naming a file is refused with exit 2', (t) => {
  const fileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rootfile-'));
  t.after(() => fs.rmSync(fileDir, { recursive: true, force: true }));
  const file = path.join(fileDir, 'f.txt');
  fs.writeFileSync(file, 'x');
  // real process: proves the refusal's exit code and stderr through the script entry
  const r = spawnCli(CLI, ['--root', file]);
  assert.strictEqual(r.code, 2);
  assert.match(r.stderr, /root is not a directory/);
});

test('AC6.1: the release commit takes its identity from the injected env', () => {
  const root = tagged('1.2.0');
  commit(root, 'fix: one');
  const r = runCli(root, [], { env: { ...ENV_PLAIN, GIT_AUTHOR_NAME: 'injected-author' } });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(fixtureGit(['-C', root, 'log', '-1', '--format=%an']).toString().trim(), 'injected-author');
});

test('runHook output reaches deps.stdout, not the inherited stdio', () => {
  const root = tagged('1.2.0');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'release-hook: "echo hook-said"\n');
  commit(root, 'feat: one');
  const r = runCli(root, [], { allowRealRunner: true });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /hook-said/);
});

function hookRepo() {
  const root = tagged('1.2.0');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'release-hook: "echo hook-said"\n');
  commit(root, 'feat: one');
  return root;
}

test('the release-hook gets inherited stdio when the CLI io is the real process io, a capture when io is injected', () => {
  const { run, realDeps } = require(CLI);
  const seen = [];
  const runHook = (cmd, o) => { seen.push(o.inherit); return { status: 0, stdout: '', stderr: '' }; };

  // Real io: the plan lines would hit the process streams, so swallow them for this synchronous call.
  const realOut = process.stdout.write;
  process.stdout.write = () => true;
  let code;
  try {
    code = run(['--root', hookRepo()], { ...realDeps, env: ENV_PLAIN, runHook });
  } finally {
    process.stdout.write = realOut;
  }
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(seen, [true]);

  const r = runCli(hookRepo(), [], { deps: { runHook } });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.deepStrictEqual(seen, [true, false]);
});

test('a hook printing more than 1 MiB still reports its real exit status', () => {
  const root = tagged('1.2.0');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'release-hook: "node big.js"\n');
  commit(root, 'feat: one', { 'big.js': "process.stdout.write('x'.repeat(2 * 1024 * 1024));\n" });
  const r = runCli(root, [], { allowRealRunner: true });
  assert.strictEqual(r.code, 0, r.stderr);
});

test('a relative --root resolves against the injected cwd, not the process cwd', () => {
  const root = tagged('1.2.0');
  commit(root, 'fix: one');
  const parent = path.dirname(root);
  assert.notEqual(parent, process.cwd());
  const r = runCliSync(CLI, ['--root', path.basename(root), '--dry-run'], { env: ENV_PLAIN, cwd: parent });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /v1\.2\.1 \(patch\)/);
});
