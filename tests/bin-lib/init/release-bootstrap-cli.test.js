'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');
const { writeIdentity } = require('../../helpers/git-fixtures');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'release-bootstrap.js');

// The complete environment the CLI sees: its git child needs PATH, and HOME keeps a global git
// config reachable. SystemRoot and USERPROFILE are what a Windows git child needs to start.
const CLI_ENV = { PATH: process.env.PATH, HOME: os.homedir() };
for (const key of ['SystemRoot', 'USERPROFILE']) if (process.env[key] !== undefined) CLI_ENV[key] = process.env[key];

// The env a spawnCli smoke gets: CLI_ENV, plus the variables tools/count-node-procs.js counts through.
const SMOKE_ENV = { ...CLI_ENV };
for (const key of ['NODE_OPTIONS', 'CT_COUNT_NODE_LOG']) if (process.env[key] !== undefined) SMOKE_ENV[key] = process.env[key];

// In-process call (#5385); maps the helper's `code` onto the `status` field the assertions use.
function run(args, opts = {}) {
  const { code, stdout, stderr } = runCliSync(CLI, args, { env: CLI_ENV, ...opts });
  return { status: code, stdout, stderr };
}

// The fixture's own git calls must not read a repo named by an inherited GIT_* variable.
function git(cwd, ...args) {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('CLI: fresh local-merge root prints the JSON envelope and exits 0', () => {
  const root = scratchDir('rb-cli-');
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}');
  // Real process: proves the script entry (the require.main guard), exit 0 and the JSON envelope on stdout.
  const res = spawnCli(CLI, ['--root', root, '--integration-model', 'local-merge', '--branch', 'main'], { env: SMOKE_ENV });
  const r = { status: res.code, stdout: res.stdout, stderr: res.stderr };
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, 'fresh');
  assert.equal(out.releaseType, 'node');
  assert.deepEqual(out.written, ['release-please-config.json', '.release-please-manifest.json']);
  assert.equal(out.policyRows.length, 2);
});

// Real process: proves the script entry turns run's usage refusal into the exit code (AC6.1); the baseline
// for a no-argument call is exit 2, empty stdout and this stderr.
test('CLI: no arguments is a usage refusal — exit 2, empty stdout, missing --integration-model plus the usage line', () => {
  const res = spawnCli(CLI, [], { env: SMOKE_ENV });
  assert.equal(res.code, 2);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, 'missing required --integration-model\nusage: release-bootstrap.js --integration-model <pr-first|local-merge|unresolved> [--root <dir>] [--branch <name>] [--release-type <type> --extra-file <path>] [--dry-run]\n');
});

test('AC9.1: the default --root is the injected cwd', () => {
  const root = scratchDir('rb-cli-');
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}');
  assert.notEqual(fs.realpathSync(root), fs.realpathSync(process.cwd()));
  const r = run(['--integration-model', 'local-merge', '--dry-run'], { cwd: root });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, 'fresh');
  assert.equal(out.releaseType, 'node');
  assert.deepEqual(out.written, ['release-please-config.json', '.release-please-manifest.json']);
  assert.equal(fs.existsSync(path.join(root, 'release-please-config.json')), false, '--dry-run writes nothing');
});

test('AC9.1: a relative --root resolves against the injected cwd, and a relative --extra-file against that root', () => {
  const parent = scratchDir('rb-cli-');
  const root = path.join(parent, 'proj');
  fs.mkdirSync(path.join(root, 'plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin', 'plugin.json'), '{"version":"4.5.6"}');
  const r = run(['--root', 'proj', '--integration-model', 'local-merge', '--release-type', 'simple', '--extra-file', 'plugin/plugin.json', '--dry-run'], { cwd: parent });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).version, '4.5.6');
});

// AC9.1 env-only fixture (model: forgePair in forge-probe-env.test.js): repo A is the CLI's cwd and
// --root and holds no tag; repo B holds v1.2.3 and is named only through GIT_DIR in the injected env,
// so the manifest is seeded from B's tag only if the git tag child gets that env.
test('AC9.1: the git tag child reads the repo named by the injected env', () => {
  const mk = (prefix) => {
    const dir = scratchDir(prefix);
    git(dir, 'init', '-b', 'main');
    writeIdentity(dir, { name: 't', email: 't@t' });
    fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
    git(dir, 'add', 'README.md');
    git(dir, 'commit', '-m', 'init');
    return dir;
  };
  const a = mk('rb-cli-a-');
  fs.writeFileSync(path.join(a, 'package.json'), '{"name":"x","version":"0.0.1"}');
  const b = mk('rb-cli-b-');
  git(b, 'tag', 'v1.2.3');
  const r = run(['--root', a, '--integration-model', 'local-merge', '--dry-run'], { cwd: a, env: { ...CLI_ENV, GIT_DIR: path.join(b, '.git') } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).version, '1.2.3');
});

test('--help prints the usage line on stdout and exits 0', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'usage: release-bootstrap.js --integration-model <pr-first|local-merge|unresolved> [--root <dir>] [--branch <name>] [--release-type <type> --extra-file <path>] [--dry-run]\n');
  assert.equal(r.stderr, '');
});

// A deleted working directory makes the real cwd() throw; the CLI reads it only where a default or relative root needs it.
const THROWING_CWD = { cwd: () => { throw Object.assign(new Error('ENOENT: process.cwd failed'), { code: 'ENOENT' }); } };

test('a throwing deps.cwd() does not break an absolute --root or --help', () => {
  const root = scratchDir('rb-cli-');
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}');
  const r = run(['--root', root, '--integration-model', 'local-merge', '--dry-run'], { deps: THROWING_CWD });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, 'fresh');
  assert.equal(out.releaseType, 'node');
  assert.deepEqual(out.written, ['release-please-config.json', '.release-please-manifest.json']);
  const h = run(['--help'], { deps: THROWING_CWD });
  assert.equal(h.status, 0, h.stderr);
  assert.ok(h.stdout.startsWith('usage: release-bootstrap.js'), h.stdout);
});

test('a relative --root that is not a directory prints the argument as given', () => {
  const parent = scratchDir('rb-cli-');
  const r = run(['--integration-model', 'local-merge', '--root', 'nope'], { cwd: parent });
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.ok(r.stderr.startsWith('root is not a directory: nope\n'), r.stderr);
});

test('with no --root, a cwd that is not a directory is named by its path', () => {
  const missing = path.join(scratchDir('rb-cli-'), 'gone');
  const r = run(['--integration-model', 'local-merge'], { cwd: missing });
  assert.equal(r.status, 2);
  assert.ok(r.stderr.startsWith(`root is not a directory: ${missing}\n`), r.stderr);
});

test('--root "" stays a not-a-directory failure, as before', () => {
  const parent = scratchDir('rb-cli-');
  const r = run(['--integration-model', 'local-merge', '--root', ''], { cwd: parent });
  assert.equal(r.status, 2);
  assert.ok(r.stderr.startsWith('root is not a directory: \n'), r.stderr);
});

test('CLI: conflict is an outcome (exit 0, verdict in JSON), missing --integration-model is usage (exit 2)', () => {
  const root = scratchDir('rb-cli-');
  fs.mkdirSync(path.join(root, '.changeset'));
  const r = run(['--root', root, '--integration-model', 'pr-first']);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).verdict, 'conflict');
  const u = run(['--root', root]);
  assert.equal(u.status, 2);
  assert.match(u.stderr, /--integration-model/);
  const unk = run(['--root', root, '--integration-model', 'pr-first', '--bogus']);
  assert.equal(unk.status, 2);
});

test('CLI: --dry-run reports the plan without writing', () => {
  const root = scratchDir('rb-cli-');
  fs.writeFileSync(path.join(root, 'go.mod'), 'module x\n');
  const r = run(['--root', root, '--integration-model', 'pr-first', '--dry-run']);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.releaseType, 'go');
  assert.equal(out.written.length, 3);
  assert.equal(fs.existsSync(path.join(root, 'release-please-config.json')), false);
});

test('CLI: a mistyped --root fails loud rather than springing into existence (F2)', () => {
  const parent = scratchDir('rb-cli-');
  const missing = path.join(parent, 'nope');
  const r = run(['--root', missing, '--integration-model', 'pr-first']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /root is not a directory: .*nope/);
  assert.equal(fs.existsSync(missing), false);
});

test('CLI: a value-expecting flag with a missing or flag-shaped next token is a usage error naming the flag (F2)', () => {
  const root = scratchDir('rb-cli-');
  const r1 = run(['--root', '--integration-model', 'pr-first']);
  assert.equal(r1.status, 2);
  assert.match(r1.stderr, /--root/);
  const r2 = run(['--root', root, '--integration-model', 'pr-first', '--branch']);
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /--branch/);
});

test('CLI: --integration-model only accepts pr-first, local-merge, or unresolved (F2)', () => {
  const root = scratchDir('rb-cli-');
  const bogus = run(['--root', root, '--integration-model', 'bogus']);
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /--integration-model/);
  const unresolved = run(['--root', root, '--integration-model', 'unresolved']);
  assert.equal(unresolved.status, 0);
  assert.equal(JSON.parse(unresolved.stdout).verdict, 'skipped');
});

test('CLI: --branch must be a valid git branch name — usage exit 2 naming the flag; the default main is unaffected (ledger row 34)', () => {
  const root = scratchDir('rb-cli-');
  const r = run(['--root', root, '--integration-model', 'pr-first', '--branch', 'a b']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--branch/);
});

test('CLI: a --branch carrying an Actions expression is a usage error (exit 2), not an unexpected throw — nothing written (#4714)', () => {
  const root = scratchDir('rb-cli-');
  const r = run(['--root', root, '--integration-model', 'pr-first', '--branch', '${{secrets.RELEASE_PLEASE_TOKEN}}']);
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stderr.split('\n')[0], 'invalid --branch: ${{secrets.RELEASE_PLEASE_TOKEN}} contains an Actions expression');
  assert.deepEqual(fs.readdirSync(root), []);
});

test('CLI: --release-type simple --extra-file <path> overrides detection and seeds the manifest from that file (AC1)', () => {
  const root = scratchDir('rb-cli-');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');
  fs.mkdirSync(path.join(root, 'plugin', '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), '{"version":"6.121.0"}');
  const r = run(['--root', root, '--integration-model', 'local-merge', '--release-type', 'simple', '--extra-file', 'plugin/.claude-plugin/plugin.json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.releaseType, 'simple');
  assert.equal(out.version, '6.121.0');
});

test('CLI: an unrecognized --release-type is a usage error naming the flag (pairing satisfied, so the vocabulary check itself fires)', () => {
  const root = scratchDir('rb-cli-');
  const r = run(['--root', root, '--integration-model', 'local-merge', '--release-type', 'bogus', '--extra-file', 'x.json']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /invalid --release-type: bogus/);
});

test('CLI: --extra-file without --release-type is a usage error naming both flags', () => {
  const root = scratchDir('rb-cli-');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');
  fs.writeFileSync(path.join(root, 'custom.json'), '{"version":"9.9.9"}');
  const r = run(['--root', root, '--integration-model', 'local-merge', '--extra-file', 'custom.json']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--release-type and --extra-file must be given together/);
});

test('CLI: --release-type without --extra-file is a usage error naming both flags', () => {
  const root = scratchDir('rb-cli-');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');
  const r = run(['--root', root, '--integration-model', 'local-merge', '--release-type', 'simple']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--release-type and --extra-file must be given together/);
});

test('CLI: --extra-file pointing to nonexistent file causes exit 1 naming it as missing', () => {
  const root = scratchDir('rb-cli-');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');
  const r = run(['--root', root, '--integration-model', 'local-merge', '--release-type', 'simple', '--extra-file', 'missing.json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--extra-file does not exist: missing\.json/);
});

test('CLI: --extra-file pointing to JSON without version causes exit 1 naming the missing field', () => {
  const root = scratchDir('rb-cli-');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');
  fs.writeFileSync(path.join(root, 'noversion.json'), '{"name":"x"}');
  const r = run(['--root', root, '--integration-model', 'local-merge', '--release-type', 'simple', '--extra-file', 'noversion.json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--extra-file has no "version" field: noversion\.json/);
});

test('CLI: --extra-file escaping the repo root causes exit 1 with a containment error', () => {
  const root = scratchDir('rb-cli-');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');
  const r = run(['--root', root, '--integration-model', 'local-merge', '--release-type', 'simple', '--extra-file', '../outside.json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--extra-file must resolve inside the repo root/);
});
