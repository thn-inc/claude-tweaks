// tests/resolve-policy-worktree-fallback.test.js — #4492: from a linked worktree
// of a project that gitignores .claude-tweaks/, resolve-policy reads the main
// checkout's policy.yml and says so on stderr. Real git, real worktree.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { gitRepo, fixtureGit, linkedWorktreeOf, cleanGitEnv } = require('./helpers/git-fixtures');
const { runCliSync } = require('./helpers/run-cli');
const { readText } = require('./helpers/read-skill');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-policy.js');

// process.env minus every GIT_CONFIG* name (git-ground-truth rule 1), plus the
// four repo-locating names cleanGitEnv drops.
function cliEnv() {
  const env = cleanGitEnv(process.env);
  for (const name of Object.keys(env)) if (name.startsWith('GIT_CONFIG')) delete env[name];
  return env;
}

const IDENTITY = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
};

// A main checkout that gitignores .claude-tweaks/ and holds a policy.yml there,
// plus a linked worktree of it (which therefore has no policy.yml).
function setup(t) {
  const main = gitRepo();
  fs.writeFileSync(path.join(main, '.gitignore'), '.claude-tweaks/\n');
  fixtureGit(['-C', main, 'add', '.gitignore'], { env: cleanGitEnv() });
  fixtureGit(['-C', main, 'commit', '-q', '-m', 'ignore policy dir'], { env: { ...cleanGitEnv(), ...IDENTITY } });
  fs.mkdirSync(path.join(main, '.claude-tweaks'));
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'integration-branch: develop\n');
  const wt = linkedWorktreeOf(main);
  t.after(() => {
    fs.rmSync(path.dirname(wt), { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
  });
  return { main, wt };
}

function cli(args, cwd) {
  return runCliSync(CLI, args, { cwd, env: cliEnv() });
}

function note(root, policyPath) {
  return `resolve-policy: note — ${root} has no .claude-tweaks/policy.yml; read the main checkout's ${policyPath}\n`;
}

test('AC1.1/AC5.2: from a linked worktree of a project that gitignores .claude-tweaks/, --values integration-branch prints develop and notes the fallback on stderr', (t) => {
  const { main, wt } = setup(t);
  const res = cli(['--values', 'integration-branch'], wt);
  assert.strictEqual(res.code, 0);
  assert.strictEqual(res.stdout, 'develop\n');
  assert.strictEqual(res.stderr, note(fs.realpathSync(wt), path.join(fs.realpathSync(main), '.claude-tweaks', 'policy.yml')));
});

test('AC2.1: a worktree with its own policy.yml uses it — prints release, no note', (t) => {
  const { wt } = setup(t);
  fs.mkdirSync(path.join(wt, '.claude-tweaks'));
  fs.writeFileSync(path.join(wt, '.claude-tweaks', 'policy.yml'), 'integration-branch: release\n');
  const res = cli(['--values', 'integration-branch'], wt);
  assert.strictEqual(res.code, 0);
  assert.strictEqual(res.stdout, 'release\n');
  assert.strictEqual(res.stderr, '');
});

test('AC3.1: from the main checkout — prints develop, stderr empty', (t) => {
  const { main } = setup(t);
  const res = cli(['--values', 'integration-branch'], main);
  assert.strictEqual(res.code, 0);
  assert.strictEqual(res.stdout, 'develop\n');
  assert.strictEqual(res.stderr, '');
});

test('JSON mode from the worktree carries the same stderr note and the unchanged { value, source } entry', (t) => {
  const { main, wt } = setup(t);
  const res = cli(['integration-branch'], wt);
  assert.strictEqual(res.code, 0);
  assert.deepStrictEqual(JSON.parse(res.stdout), { 'integration-branch': { value: 'develop', source: 'policy' } });
  assert.strictEqual(res.stderr, note(fs.realpathSync(wt), path.join(fs.realpathSync(main), '.claude-tweaks', 'policy.yml')));
});

test('warningLines: an in-process caller gets the note first in both modes, and none for a checkout-sourced policy', () => {
  const { warningLines } = require('../plugin/bin/resolve-policy');
  const mk = (policySource) => ({
    keys: ['integration-branch'],
    result: { 'integration-branch': { value: 'main', source: 'default', invalid: true } },
    invalidRaw: new Map([['integration-branch', 'bad']]),
    degrades: new Map(),
    root: '/r',
    policySource,
    policyPath: '/m/.claude-tweaks/policy.yml',
  });
  const expected = note('/r', '/m/.claude-tweaks/policy.yml');
  const withValues = warningLines(mk('main-checkout'), { values: true });
  assert.strictEqual(withValues[0], expected);
  assert.strictEqual(withValues.length, 2); // note, then the invalid-value warning
  assert.deepStrictEqual(warningLines(mk('main-checkout'), { values: false }), [expected]);
  for (const values of [true, false]) {
    assert.ok(!warningLines(mk('checkout'), { values }).some((line) => line.includes('note —')));
  }
});

// F2: /help policy's apply path must not write a worktree-local policy.yml when the worktree
// reads the main checkout's file — the new file would win outright and hide every other key.
test('help/policy.md apply path: the worktree-fallback branch names the resolve-policy note and forbids a worktree-local write', () => {
  const md = readText(path.join(__dirname, '..', 'plugin', 'skills', 'help', 'policy.md'));
  const branch = md.slice(md.indexOf('**Worktree-fallback branch'), md.indexOf('**If section 3 yielded zero'));
  assert.ok(branch.length > 0, 'the worktree-fallback branch must exist before the zero-recommendation paragraph');
  assert.match(branch, /resolve-policy: note — \{root\} has no \.claude-tweaks\/policy\.yml; read the main checkout's \{policyPath\}/);
  assert.match(branch, /never write a worktree-local `\.claude-tweaks\/policy\.yml`/);
  assert.match(md, /\| Writing a worktree-local policy\.yml when the worktree reads the main checkout's file \|/);
});
