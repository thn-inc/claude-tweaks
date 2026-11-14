// tests/forge-probe-env.test.js
// The forge probe's library functions take an injected `env` (and `stderr`, `homeDir`, `cwd`) and
// hand it on to every `git` / `gh` child and every environment read on their path, so a caller
// can run them against a repository and environment that are not the test process's own. Each test
// here proves one hand-off; a call with none of the options keeps today's behaviour.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  detectIntegrationModel, resolveForgeProbeTimeoutMs, resolvePolicyConfig,
} = require('../plugin/bin/lib/policy-schema');
const { computeDerivedDefaults } = require('../plugin/bin/lib/policy-derived-defaults');
const { deriveMergeVerification } = require('../plugin/bin/lib/merge-verification');
const { resolveIntegrationBranch } = require('../plugin/bin/lib/hooks/worktree-reap');
const { _resetGhHostCache, resolveGhHost } = require('../plugin/bin/lib/repo-resolve');
const { STUB_SKIP, pathWithOnly } = require('./helpers/path-stub');
const { fixtureGit } = require('./helpers/git-fixtures');

const GH_ORIGIN = 'https://github.com/o/r.git';
const GHE_ORIGIN = 'https://ghe.example.test/o/r.git';
const GHE_HOST = 'ghe.example.test';
const CI_WORKFLOW = 'on:\n  pull_request:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n';

function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `forge-probe-${prefix}-`)));
}

// A fixture git call that ignores any repo-locating variable the test process inherited.
function git(cwd, args) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[k];
  return fixtureGit(args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function initRepo(prefix) {
  const dir = tmp(prefix);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

// Repo A has no remote; repo B has origin and a recorded origin/HEAD. `GIT_DIR=<B>/.git` in a child
// whose cwd is A reads B's remote and refs while `--show-toplevel` still prints A.
function forgePair({ origin }) {
  const a = initRepo('a');
  const b = initRepo('b');
  git(b, ['remote', 'add', 'origin', origin]);
  git(b, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(b, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  return { a, b, gitDir: path.join(b, '.git') };
}

// A `gh` script in its own directory, for an injected-only PATH (installStub would edit process.env.PATH).
function ghStubDir(body) {
  const dir = tmp('gh-stub');
  const file = path.join(dir, 'gh');
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755); // root-safe: exec-bit stub, not a denial simulation
  return dir;
}

function injectedEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.GH_HOST;
  delete env.GH_REPO;
  return env;
}

test('detectIntegrationModel: the git and gh children get opts.env', { skip: STUB_SKIP }, () => {
  _resetGhHostCache();
  const { a, gitDir } = forgePair({ origin: GH_ORIGIN });
  const marker = path.join(tmp('marker'), 'ran');
  const stubDir = ghStubDir(`echo ran > "${marker}"`);
  const env = injectedEnv({ GIT_DIR: gitDir, PATH: stubDir + path.delimiter + process.env.PATH });
  assert.equal(detectIntegrationModel(a), 'local-merge');
  assert.equal(fs.existsSync(marker), false);
  assert.equal(detectIntegrationModel(a, { env }), 'pr-first');
  assert.equal(fs.existsSync(marker), true);
});

test('detectIntegrationModel: a GitHub Enterprise origin read through opts.env sets GH_HOST for the gh child, and the note goes to opts.stderr', { skip: STUB_SKIP }, () => {
  _resetGhHostCache();
  const { a, gitDir } = forgePair({ origin: GHE_ORIGIN });
  const marker = path.join(tmp('marker'), 'host');
  const stubDir = ghStubDir(`printf '%s' "$GH_HOST" > "${marker}"`);
  const ghConfig = tmp('ghcfg');
  fs.writeFileSync(path.join(ghConfig, 'hosts.yml'), `${GHE_HOST}:\n`);
  const env = injectedEnv({ GIT_DIR: gitDir, GH_CONFIG_DIR: ghConfig, PATH: stubDir + path.delimiter + process.env.PATH });
  const notes = [];
  assert.equal(detectIntegrationModel(a, { env, stderr: (s) => notes.push(s) }), 'pr-first');
  assert.equal(fs.readFileSync(marker, 'utf8').trim(), GHE_HOST);
  assert.match(notes.join(''), /gh calls get GH_HOST=ghe\.example\.test/);
});

test('detectIntegrationModel: hosts.yml is read under opts.homeDir() when the env names no gh config dir', { skip: STUB_SKIP }, () => {
  const { a, gitDir } = forgePair({ origin: GHE_ORIGIN });
  const marker = path.join(tmp('marker'), 'host');
  const stubDir = ghStubDir(`printf '%s' "$GH_HOST" > "${marker}"`);
  const home = tmp('home');
  fs.mkdirSync(path.join(home, '.config', 'gh'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'gh', 'hosts.yml'), `${GHE_HOST}:\n`);
  const emptyDir = tmp('empty-home');
  const env = injectedEnv({ GIT_DIR: gitDir, PATH: stubDir + path.delimiter + process.env.PATH });
  delete env.GH_CONFIG_DIR;
  delete env.XDG_CONFIG_HOME;

  _resetGhHostCache();
  assert.equal(detectIntegrationModel(a, { env, homeDir: () => home, stderr: () => {} }), 'pr-first');
  assert.equal(fs.readFileSync(marker, 'utf8').trim(), GHE_HOST);

  _resetGhHostCache();
  fs.rmSync(marker);
  assert.equal(detectIntegrationModel(a, { env, homeDir: () => emptyDir, stderr: () => {} }), 'pr-first');
  assert.equal(fs.readFileSync(marker, 'utf8').trim(), '');
});

test('resolveGhHost: two lookups for one cwd with different injected env each get their own answer', () => {
  _resetGhHostCache();
  const root = initRepo('memo');
  git(root, ['remote', 'add', 'origin', GHE_ORIGIN]);
  const knownCfg = tmp('ghcfg-known');
  fs.writeFileSync(path.join(knownCfg, 'hosts.yml'), `${GHE_HOST}:\n`);
  const unknownCfg = tmp('ghcfg-unknown');
  fs.writeFileSync(path.join(unknownCfg, 'hosts.yml'), 'other.example.test:\n');
  const known = injectedEnv({ GH_CONFIG_DIR: knownCfg });
  const unknown = injectedEnv({ GH_CONFIG_DIR: unknownCfg });
  assert.equal(resolveGhHost(root, { env: known }), GHE_HOST);
  assert.equal(resolveGhHost(root, { env: unknown }), null);
  assert.equal(resolveGhHost(root, { env: known }), GHE_HOST);
});

test('detectIntegrationModel: a homeDir that throws never escapes', { skip: STUB_SKIP }, () => {
  _resetGhHostCache();
  const { a, gitDir } = forgePair({ origin: GHE_ORIGIN });
  const stubDir = ghStubDir('exit 0');
  const env = injectedEnv({ GIT_DIR: gitDir, PATH: stubDir + path.delimiter + process.env.PATH });
  delete env.GH_CONFIG_DIR;
  delete env.XDG_CONFIG_HOME;
  // The throw lands inside ghConfigHosts' read, which reads it as no hosts.yml: the host is not
  // known, so gh runs with no GH_HOST and the stub's exit 0 is a reachable forge.
  const result = detectIntegrationModel(a, { env, homeDir: () => { throw new Error('no home'); }, stderr: () => {} });
  assert.equal(result, 'pr-first');
});

test('resolveForgeProbeTimeoutMs reads CLAUDE_TWEAKS_GH_TIMEOUT_MS from opts.env and ignores process.env when opts.env is given', () => {
  const root = tmp('timeout');
  const prior = process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
  process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = '4321';
  try {
    assert.equal(resolveForgeProbeTimeoutMs(root, { env: { CLAUDE_TWEAKS_GH_TIMEOUT_MS: '1234' } }), 1234);
    assert.equal(resolveForgeProbeTimeoutMs(root, { env: {} }), 5000);
    assert.equal(resolveForgeProbeTimeoutMs(root), 4321);
  } finally {
    if (prior === undefined) delete process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
    else process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = prior;
  }
});

test('resolvePolicyConfig falls back to the given cwd when git fails', () => {
  const other = tmp('cwd');
  const seen = [];
  const base = {
    git: () => { throw new Error('no git'); },
    readFile: (p) => { seen.push(p); return null; },
    keys: ['autonomy'],
  };
  const withCwd = resolvePolicyConfig({ ...base, cwd: other });
  assert.equal(withCwd.root, other);
  assert.equal(seen[0], path.join(other, '.claude-tweaks', 'policy.yml'));
  assert.equal(resolvePolicyConfig(base).root, process.cwd());
});

test('computeDerivedDefaults forwards deps.env and deps.stderr, and adds no key when they are absent', () => {
  const E = { A: '1' };
  const S = () => {};
  const H = () => '/home';
  const recordModel = () => {
    const seen = [];
    return { seen, fn: (root, opts) => { seen.push(opts); return 'local-merge'; } };
  };
  const fresh = () => ({ 'integration-model': { value: null, source: 'default' } });

  const given = recordModel();
  computeDerivedDefaults(fresh(), ['integration-model'], '/r', { detectIntegrationModel: given.fn, env: E, stderr: S, homeDir: H });
  assert.equal(given.seen[0].env, E);
  assert.equal(given.seen[0].stderr, S);
  assert.equal(given.seen[0].homeDir, H);

  const absent = recordModel();
  computeDerivedDefaults(fresh(), ['integration-model'], '/r', { detectIntegrationModel: absent.fn });
  for (const k of ['env', 'homeDir', 'stderr']) assert.equal(k in absent.seen[0], false);

  const mvSeen = [];
  const deriveMergeVerification = (root, deps) => { mvSeen.push(deps); return 'off'; };
  const mvResult = () => ({ 'merge-verification': { value: null, source: 'default' } });
  const modelSeen = [];
  const resolveIntegrationModel = (root, opts) => { modelSeen.push(opts); return 'pr-first'; };
  computeDerivedDefaults(mvResult(), ['merge-verification'], '/r', { deriveMergeVerification, resolveIntegrationModel, env: E, stderr: S, homeDir: H });
  assert.equal(mvSeen[0].env, E);
  assert.equal(mvSeen[0].homeDir, H);
  assert.equal(mvSeen[0].stderr, S);
  mvSeen[0].integrationModel('/r');
  assert.equal(modelSeen[0].env, E);
  assert.equal(modelSeen[0].stderr, S);
  assert.equal(modelSeen[0].homeDir, H);

  computeDerivedDefaults(mvResult(), ['merge-verification'], '/r', { deriveMergeVerification, resolveIntegrationModel });
  assert.equal('env' in mvSeen[1], false);
  assert.equal('homeDir' in mvSeen[1], false);
  assert.equal('stderr' in mvSeen[1], false);
  mvSeen[1].integrationModel('/r');
  for (const k of ['env', 'homeDir', 'stderr']) assert.equal(k in modelSeen[1], false);
});

test('resolveIntegrationBranch reads origin/HEAD through opts.env', () => {
  const { a, gitDir } = forgePair({ origin: GH_ORIGIN });
  assert.equal(resolveIntegrationBranch(a), null);
  assert.equal(resolveIntegrationBranch(a, undefined, { env: { ...process.env, GIT_DIR: gitDir } }), 'main');
});

test('deriveMergeVerification: both branch lookups get deps.env', () => {
  const { a, gitDir } = forgePair({ origin: GH_ORIGIN });
  fs.mkdirSync(path.join(a, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(a, '.github', 'workflows', 'ci.yml'), CI_WORKFLOW);
  const noGhPath = pathWithOnly(['git'], { exclude: ['gh'] });
  const env = { ...process.env, GIT_DIR: gitDir, PATH: noGhPath };
  // The no-env control inherits process.env, so its PATH is narrowed the same way: no test reaches the real gh.
  const priorPath = process.env.PATH;
  process.env.PATH = noGhPath;
  try {
    assert.equal(deriveMergeVerification(a, { integrationModel: () => 'pr-first' }), 'off');
  } finally {
    process.env.PATH = priorPath;
  }
  assert.equal(deriveMergeVerification(a, { integrationModel: () => 'pr-first', env }), 'merge-when-green');
});

test('deriveMergeVerification: its own integration-model lookup gets deps.env, deps.homeDir and deps.stderr', { skip: STUB_SKIP }, () => {
  _resetGhHostCache();
  const { a, gitDir } = forgePair({ origin: GHE_ORIGIN });
  fs.mkdirSync(path.join(a, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(a, '.github', 'workflows', 'ci.yml'), CI_WORKFLOW);
  const marker = path.join(tmp('marker'), 'host');
  // Records GH_HOST on the forge probe (`repo view --json owner,name`) only; every call prints `main`.
  const stubDir = ghStubDir(`case "$*" in *owner,name*) printf '%s' "$GH_HOST" > "${marker}";; esac\necho main`);
  const home = tmp('home');
  fs.mkdirSync(path.join(home, '.config', 'gh'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'gh', 'hosts.yml'), `${GHE_HOST}:\n`);
  const env = injectedEnv({ GIT_DIR: gitDir, PATH: stubDir + path.delimiter + process.env.PATH });
  delete env.GH_CONFIG_DIR;
  delete env.XDG_CONFIG_HOME;
  const notes = [];
  assert.equal(deriveMergeVerification(a, { env, homeDir: () => home, stderr: (s) => notes.push(s) }), 'merge-when-green');
  assert.equal(fs.readFileSync(marker, 'utf8'), GHE_HOST);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /gh calls get GH_HOST=ghe\.example\.test/);
});

test("deriveMergeVerification: readDefaultBranch's gh child gets deps.env", { skip: STUB_SKIP }, () => {
  _resetGhHostCache();
  const root = initRepo('plain');
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), CI_WORKFLOW);
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-branch: trunk\n');
  const stubDir = ghStubDir('echo trunk');
  const env = injectedEnv({ PATH: stubDir + path.delimiter + process.env.PATH });
  assert.equal(deriveMergeVerification(root, { integrationModel: () => 'pr-first', env }), 'merge-when-green');
  const noGh = { ...process.env, PATH: pathWithOnly(['git'], { exclude: ['gh'] }) };
  assert.equal(deriveMergeVerification(root, { integrationModel: () => 'pr-first', env: noGh }), 'off');
});
