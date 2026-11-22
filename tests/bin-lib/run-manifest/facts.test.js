'use strict';
// #5903: the run manifest's fact gatherers — plugin version, policy hash, base commit, model profile.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir } = require('../../helpers/tmp-dir');
const { gitRepo, fixtureGit, cleanGitEnv, initRepo } = require('../../helpers/git-fixtures');
const facts = require('../../../plugin/bin/lib/run-manifest/facts');

const { gatherFacts, canonicalJson, FORGE_DERIVED_POLICY_KEYS } = facts;

const GIT_ENV = {
  ...cleanGitEnv(),
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
};

function git(cwd, ...args) {
  return fixtureGit(['-C', cwd, ...args], { env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function repoWithPolicy(policyText, opts) {
  const dir = gitRepo(opts);
  if (policyText !== null && policyText !== undefined) {
    fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), policyText);
  }
  return dir;
}

function fixturePlugin(version) {
  const root = scratchDir('run-manifest-plugin-');
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'claude-tweaks', version }));
  return root;
}

// A repo with a bare origin: `main` pushed, so refs/remotes/origin/main exists, then one commit that exists
// only locally so the local HEAD and the origin tip differ.
function repoWithOrigin(policyText) {
  const dir = repoWithPolicy(policyText, { branch: 'main' });
  const bare = scratchDir('run-manifest-origin-');
  initRepo(bare, { bare: true, branch: 'main', env: GIT_ENV });
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', 'origin', 'main');
  const originTip = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'commit', '--allow-empty', '-q', '-m', 'local only');
  return { dir, originTip, localHead: git(dir, 'rev-parse', 'HEAD') };
}

const baseEnv = { ...process.env, CLAUDE_PLUGIN_ROOT: '' };

test('FORGE_DERIVED_POLICY_KEYS is the frozen pair of forge-derived keys', () => {
  assert.deepEqual([...FORGE_DERIVED_POLICY_KEYS], ['integration-model', 'merge-verification']);
  assert.ok(Object.isFrozen(FORGE_DERIVED_POLICY_KEYS));
});

test('policyHash starts sha256: and is 64 hex after the prefix', () => {
  const dir = repoWithPolicy('project-maturity: greenfield\n');
  const { policyHash } = gatherFacts({ cwd: dir, env: baseEnv });
  assert.match(policyHash, /^sha256:[0-9a-f]{64}$/);
});

test('two policies resolving to the same values hash equal', () => {
  const explicit = repoWithPolicy('project-maturity: greenfield\n');
  const omitted = repoWithPolicy('');
  const a = gatherFacts({ cwd: explicit, env: baseEnv }).policyHash;
  const b = gatherFacts({ cwd: omitted, env: baseEnv }).policyHash;
  assert.ok(a);
  assert.equal(a, b);
});

test('changing project-maturity changes the hash', () => {
  const greenfield = repoWithPolicy('project-maturity: greenfield\n');
  const established = repoWithPolicy('project-maturity: established\n');
  assert.notEqual(
    gatherFacts({ cwd: greenfield, env: baseEnv }).policyHash,
    gatherFacts({ cwd: established, env: baseEnv }).policyHash,
  );
});

test('changing only integration-model does not change the hash', () => {
  const prFirst = repoWithPolicy('project-maturity: greenfield\nintegration-model: pr-first\n');
  const localMerge = repoWithPolicy('project-maturity: greenfield\nintegration-model: local-merge\n');
  const a = gatherFacts({ cwd: prFirst, env: baseEnv }).policyHash;
  const b = gatherFacts({ cwd: localMerge, env: baseEnv }).policyHash;
  assert.ok(a);
  assert.equal(a, b);
});

// The factory layer (#6006) is part of the policy a run resolved, so it is part of the hash. The home
// directory is an empty temp dir: the machine's own ~/.claude-tweaks/factory-policy.yml must not decide.
test('AC6.1: a factory-set hashed key changes policyHash', () => {
  const dir = repoWithPolicy('');
  const env = { ...baseEnv, HOME: scratchDir('run-manifest-home-'), USERPROFILE: '' };
  delete env.CLAUDE_TWEAKS_FACTORY_POLICY;
  const without = gatherFacts({ cwd: dir, env }).policyHash;
  const withFactory = gatherFacts({ cwd: dir, env: { ...env, CLAUDE_TWEAKS_FACTORY_POLICY: 'tidy-aggressiveness: aggressive' } }).policyHash;
  assert.ok(without && withFactory);
  assert.notEqual(without, withFactory);
});

test('AC9.1: driver mint records the policyHash resolvePolicy computes with the parent\'s variable', () => {
  const dir = repoWithPolicy('');
  const env = { ...baseEnv, ...cleanGitEnv(), HOME: scratchDir('run-manifest-home-'), USERPROFILE: '', CLAUDE_TWEAKS_FACTORY_POLICY: 'tidy-aggressiveness: aggressive' };
  const script = path.join(scratchDir('run-manifest-script-'), 'mint.js');
  const resolveModule = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'hooks', 'run-dir-resolve.js');
  fs.writeFileSync(script, `const r = require(${JSON.stringify(resolveModule)}).resolve({ cwd: ${JSON.stringify(dir)}, env: {}, specSlug: 'drive-1', create: true });\nprocess.stdout.write(JSON.stringify(r));\n`);
  // real process: the criterion is about the minting process's own environment
  const child = spawnSync(process.execPath, [script], { env, encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  const minted = JSON.parse(child.stdout);
  assert.equal(minted.ok, true, minted.message);
  const manifest = JSON.parse(fs.readFileSync(path.join(minted.path, 'manifest.json'), 'utf8'));
  assert.equal(manifest.lane, 'driver');
  assert.match(manifest.policyHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(manifest.policyHash, gatherFacts({ cwd: dir, env }).policyHash);
  const unset = { ...env };
  delete unset.CLAUDE_TWEAKS_FACTORY_POLICY;
  assert.notEqual(manifest.policyHash, gatherFacts({ cwd: dir, env: unset }).policyHash, 'the variable is what the hash reflects');
});

test('canonicalJson sorts keys at every depth and emits no whitespace', () => {
  const out = canonicalJson({ b: 1, a: { z: [3, { y: 2, x: 1 }], c: null }, d: 'x y' });
  assert.equal(out, '{"a":{"c":null,"z":[3,{"x":1,"y":2}]},"b":1,"d":"x y"}');
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
});

test('pluginVersion is null with CLAUDE_PLUGIN_ROOT unset, and the string version with a fixture plugin.json', () => {
  const dir = repoWithPolicy('');
  const noRoot = { ...process.env };
  delete noRoot.CLAUDE_PLUGIN_ROOT;
  assert.equal(gatherFacts({ cwd: dir, env: noRoot }).pluginVersion, null);
  const root = fixturePlugin('9.8.7');
  assert.equal(gatherFacts({ cwd: dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: root } }).pluginVersion, '9.8.7');
});

test('policyHash is null when policy.yml exists but cannot be read', () => {
  const dir = repoWithPolicy('project-maturity: greenfield\n');
  const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  const out = gatherFacts({ cwd: dir, env: baseEnv }, {
    readFile: (p) => {
      if (p.endsWith('policy.yml')) throw eacces;
      return fs.readFileSync(p, 'utf8');
    },
  });
  assert.equal(out.policyHash, null);
  assert.equal(out.modelProfile, null);
});

test('an ENOENT from the reader reads as no file, not as an unreadable policy', () => {
  const dir = repoWithPolicy('project-maturity: greenfield\n');
  const enoent = Object.assign(new Error('gone'), { code: 'ENOENT' });
  const out = gatherFacts({ cwd: dir, env: baseEnv }, { readFile: () => { throw enoent; } });
  assert.match(out.policyHash, /^sha256:[0-9a-f]{64}$/);
});

test('baseCommit is the 40-hex tip of origin/<pinned integration-branch>', () => {
  const { dir, originTip, localHead } = repoWithOrigin('integration-branch: main\n');
  const { baseCommit } = gatherFacts({ cwd: dir, env: baseEnv });
  assert.match(baseCommit, /^[0-9a-f]{40}$/);
  assert.equal(baseCommit, originTip);
  assert.notEqual(baseCommit, localHead);
});

test('baseCommit falls back to origin/HEAD when unpinned', () => {
  const { dir, originTip } = repoWithOrigin('');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  assert.equal(gatherFacts({ cwd: dir, env: baseEnv }).baseCommit, originTip);
});

test('baseCommit is null with no remote refs', () => {
  const dir = repoWithPolicy('integration-branch: main\n', { branch: 'main' });
  assert.equal(gatherFacts({ cwd: dir, env: baseEnv }).baseCommit, null);
});

test('baseCommit is null outside a git repo', () => {
  const dir = scratchDir('run-manifest-nogit-');
  const out = gatherFacts({ cwd: dir, env: baseEnv });
  assert.equal(out.baseCommit, null);
});

test('gatherFacts with env undefined falls back to the process environment, not a stripped one', (t) => {
  const dir = repoWithPolicy('');
  const root = fixturePlugin('4.5.6');
  const prev = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = root;
  t.after(() => {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = prev;
  });
  assert.equal(gatherFacts({ cwd: dir, env: undefined }).pluginVersion, '4.5.6');
});

test('modelProfile reads model-stance and model-ceiling', () => {
  const plain = repoWithPolicy('');
  assert.deepEqual(gatherFacts({ cwd: plain, env: baseEnv }).modelProfile, { stance: 'default', ceiling: null });
  const pinned = repoWithPolicy('model-stance: economy\nmodel-ceiling: standard\n');
  assert.deepEqual(gatherFacts({ cwd: pinned, env: baseEnv }).modelProfile, { stance: 'economy', ceiling: 'standard' });
});

test('gatherFacts never throws and the other fields survive when one gatherer throws', () => {
  const dir = repoWithPolicy('');
  const root = fixturePlugin('1.2.3');
  let out;
  assert.doesNotThrow(() => {
    out = gatherFacts({ cwd: dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: root } }, {
      runGit: () => { throw new Error('git exploded'); },
      resolveIntegrationBranch: () => { throw new Error('resolver exploded'); },
    });
  });
  assert.equal(out.baseCommit, null);
  assert.equal(out.pluginVersion, '1.2.3');
  assert.match(out.policyHash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(out.modelProfile, { stance: 'default', ceiling: null });
});

test('gatherFacts survives a throwing runGit when the resolver names a ref', () => {
  const dir = repoWithPolicy('');
  const out = gatherFacts({ cwd: dir, env: baseEnv }, {
    resolveIntegrationBranch: () => 'origin/main',
    runGit: () => { throw new Error('git exploded'); },
  });
  assert.equal(out.baseCommit, null);
  assert.match(out.policyHash, /^sha256:[0-9a-f]{64}$/);
});
