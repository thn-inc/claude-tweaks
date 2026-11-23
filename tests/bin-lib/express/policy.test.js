'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { STUB_SKIP } = require('../../helpers/path-stub');
const { fakeGh } = require('../../helpers/fake-gh');
const { initRepo } = require('../../helpers/git-fixtures');

const { defaultResolvePolicy } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'express', 'policy.js'));

// defaultResolvePolicy reads the repo root from the process cwd (its git seam passes no cwd),
// so the test runs from inside the fixture repo and restores the cwd afterwards.
test('defaultResolvePolicy hands the run config to computeDerivedDefaults: a merge-verification-only read under a run-pinned integration-model never spawns gh (#4578 AC13.1)', { skip: STUB_SKIP }, () => {
  const root = fs.realpathSync(scratchDir('express-policy-runpin-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  initRepo(root, { name: 't', email: 't@example.invalid', cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('remote', 'add', 'origin', 'https://github.com/o/n.git');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-10-31T000000-record-7');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'integration-model: local-merge\n');
  const KEY = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';
  const savedEnv = process.env[KEY];
  const savedCwd = process.cwd();
  process.env[KEY] = '1000';
  const gh = fakeGh({ first: 'hang' });
  let calls;
  let resolved;
  try {
    process.chdir(root);
    resolved = defaultResolvePolicy(['merge-verification'], { runDir });
    calls = gh.count();
  } finally {
    process.chdir(savedCwd);
    gh.restore();
    if (savedEnv === undefined) delete process.env[KEY]; else process.env[KEY] = savedEnv;
  }
  assert.strictEqual(calls, 0, 'the run pin decides merge-verification before any forge detection');
  assert.strictEqual(resolved['merge-verification'].value, 'off');
});

test('defaultResolvePolicy returns the model-profiles block the CLI returns (#5917)', { skip: STUB_SKIP }, () => {
  const root = fs.realpathSync(scratchDir('express-policy-modelprofiles-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  initRepo(root, { name: 't', email: 't@example.invalid', cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  git('commit', '-q', '--allow-empty', '-m', 'init');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'model-profiles:\n  standard:\n    model: opus\nmodel-ceiling: capable\n');
  const savedCwd = process.cwd();
  let resolved;
  try {
    process.chdir(root);
    resolved = defaultResolvePolicy(['model-profiles', 'model-ceiling']);
  } finally {
    process.chdir(savedCwd);
  }
  assert.deepStrictEqual(resolved, {
    'model-profiles': { value: { standard: { model: 'opus' } }, source: 'policy' },
    'model-ceiling': { value: 'capable', source: 'policy' },
  });
});

test('express policy merges a factory model-profiles row', { skip: STUB_SKIP }, () => {
  const root = fs.realpathSync(scratchDir('express-policy-factory-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  initRepo(root, { name: 't', email: 't@example.invalid', cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  git('commit', '-q', '--allow-empty', '-m', 'init');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'model-profiles:\n  standard:\n    model: opus\n');
  const KEY = 'CLAUDE_TWEAKS_FACTORY_POLICY';
  const savedEnv = process.env[KEY];
  const savedHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const savedCwd = process.cwd();
  process.env[KEY] = 'model-profiles:\n  fast:\n    model: haiku\n';
  process.env.HOME = fs.realpathSync(scratchDir('express-policy-home-'));
  process.env.USERPROFILE = process.env.HOME;
  let resolved;
  try {
    process.chdir(root);
    resolved = defaultResolvePolicy(['model-profiles']);
  } finally {
    process.chdir(savedCwd);
    if (savedEnv === undefined) delete process.env[KEY]; else process.env[KEY] = savedEnv;
    for (const [k, v] of Object.entries(savedHome)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  assert.deepStrictEqual(resolved['model-profiles'].value, { standard: { model: 'opus' }, fast: { model: 'haiku' } });
});

// --- protected-paths (#6020): read from the main checkout, never the record's worktree ---

const { gitRepo, harnessWorktreeOf, fixtureGit } = require('../../helpers/git-fixtures');
const { protectedPathGlobsOf, resolveProtectedPathsEntry } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'express', 'policy.js'));
const { SHIPPED_PROTECTED_PATHS, evaluateRecordEligibility } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'express', 'eligibility.js'));
const { resolvePolicyKeys } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'policy-schema.js'));

function writePolicy(dir, text) {
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), text);
}

function entryFrom(dir) {
  const saved = process.cwd();
  process.chdir(dir);
  try { return defaultResolvePolicy(['protected-paths'])['protected-paths']; } finally { process.chdir(saved); }
}

function globsFrom(dir) {
  const saved = process.cwd();
  process.chdir(dir);
  try { return protectedPathGlobsOf(defaultResolvePolicy(['protected-paths'])['protected-paths']); } finally { process.chdir(saved); }
}

test('AC5.2: unset, absent and unreadable policy.yml all yield the shipped list through the real resolver', () => {
  const absent = gitRepo();
  assert.deepStrictEqual(globsFrom(absent), SHIPPED_PROTECTED_PATHS);
  const unrelated = gitRepo();
  writePolicy(unrelated, 'merge-verification: off\n');
  assert.deepStrictEqual(globsFrom(unrelated), SHIPPED_PROTECTED_PATHS);
  const unreadable = gitRepo();
  fs.mkdirSync(path.join(unreadable, '.claude-tweaks', 'policy.yml'), { recursive: true });
  assert.deepStrictEqual(globsFrom(unreadable), SHIPPED_PROTECTED_PATHS);
});

test('AC5.1, AC10.1 (real resolver): malformed values yield the shipped list, never []', () => {
  for (const raw of ['["infra/**"]', '""', 'infra/**,', 'app/[slug]/**']) {
    const main = gitRepo();
    writePolicy(main, `protected-paths: ${raw}\n`);
    assert.strictEqual(entryFrom(main).invalid, true, raw);
    assert.deepStrictEqual(globsFrom(main), SHIPPED_PROTECTED_PATHS, raw);
  }
  for (const [raw, want] of [['[]', []], ['infra/**', ['infra/**']], ['no/such/**', ['no/such/**']]]) {
    const main = gitRepo();
    writePolicy(main, `protected-paths: ${raw}\n`);
    assert.deepStrictEqual(globsFrom(main), want, raw);
  }
});

test('AC8.1 (resolver half): from a linked worktree the main checkout\'s value wins', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'rec');
  writePolicy(wt, 'protected-paths: infra/**\n');
  assert.deepStrictEqual(globsFrom(wt), SHIPPED_PROTECTED_PATHS);
  const record = { number: 1, title: 't', labels: [{ name: 'risk:low' }, { name: 'size:low' }, { name: 'ceremony:fast-lane' }, { name: 'type:task' }], body: '## Technical Approach\n\n### Key Files\n\n- `package.json` (modify)\n' };
  const verdict = evaluateRecordEligibility(record, { enabled: true, integrationModel: 'pr-first', protectedPathGlobs: globsFrom(wt) });
  assert.ok(verdict.reasons.includes('protected path: package.json'), JSON.stringify(verdict.reasons));
  const main2 = gitRepo();
  const wt2 = harnessWorktreeOf(main2, 'rec');
  writePolicy(main2, 'protected-paths: infra/**\n');
  writePolicy(wt2, 'protected-paths: []\n');
  assert.deepStrictEqual(globsFrom(wt2), ['infra/**']);
});

test('Review Focus 2: a worktree [] never reaches a main checkout with no policy.yml', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'rec');
  writePolicy(wt, 'protected-paths: []\n');
  assert.deepStrictEqual(resolveProtectedPathsEntry(wt), { value: [], source: 'default' });
});

test('a --separate-git-dir checkout (no linked worktree, no main root) still reads its own configured list', () => {
  const dir = fs.realpathSync(scratchDir('ct-sepgit-'));
  const work = path.join(dir, 'work');
  fs.mkdirSync(work);
  fixtureGit(['init', '-q', '--separate-git-dir', path.join(dir, 'admin'), work]);
  writePolicy(work, 'protected-paths: infra/**\n');
  assert.deepStrictEqual(globsFrom(work), ['infra/**']);
});

// The entry and every stderr write while it resolved, from `cwd`.
function entryWithStderr(cwd) {
  const writes = [];
  const real = process.stderr.write;
  process.stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
  try { return { entry: resolveProtectedPathsEntry(cwd), writes }; } finally { process.stderr.write = real; }
}
const WARNING = /^express-policy: protected-paths not read \(.+\) — shipped list applies\n$/;
const INVALID_ENTRY = { value: [], source: 'default', invalid: true };

function separateGitDirRepo() {
  const dir = fs.realpathSync(scratchDir('ct-sepgit-'));
  const work = path.join(dir, 'work');
  fs.mkdirSync(work);
  fixtureGit(['init', '-q', '--separate-git-dir', path.join(dir, 'admin'), work]);
  fixtureGit(['-C', work, 'commit', '--allow-empty', '-m', 'init', '-q']);
  return work;
}

test('a linked worktree of a --separate-git-dir checkout never reads its own list: the warned shipped-list fallback', () => {
  const work = separateGitDirRepo();
  writePolicy(work, 'protected-paths: infra/**\n');
  const wt = path.join(path.dirname(work), 'linked');
  fixtureGit(['-C', work, 'worktree', 'add', '-q', wt, '-b', 'linked-branch']);
  writePolicy(wt, 'protected-paths: []\n');
  const { entry, writes } = entryWithStderr(wt);
  assert.deepStrictEqual(entry, INVALID_ENTRY);
  assert.strictEqual(writes.length, 1);
  assert.match(writes[0], WARNING);
  assert.ok(writes[0].includes('no main checkout resolved'), writes[0]);
  assert.deepStrictEqual(protectedPathGlobsOf(entry), SHIPPED_PROTECTED_PATHS);
});

test('a linked worktree of a submodule reads the submodule main checkout recorded as core.worktree', () => {
  const upstream = gitRepo();
  const parent = gitRepo();
  fixtureGit(['-C', parent, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', upstream, 'mod']);
  const sub = path.join(parent, 'mod');
  writePolicy(sub, 'protected-paths: infra/**\n');
  const wt = path.join(fs.realpathSync(scratchDir('ct-sublinked-')), 'wt');
  fixtureGit(['-C', sub, 'worktree', 'add', '-q', wt, '-b', 'sub-linked-branch']);
  writePolicy(wt, 'protected-paths: []\n');
  const { entry, writes } = entryWithStderr(wt);
  assert.deepStrictEqual(entry, { value: 'infra/**', source: 'policy' });
  assert.deepStrictEqual(writes, []);
  // The submodule's own main checkout reads itself.
  assert.deepStrictEqual(entryWithStderr(sub).entry, { value: 'infra/**', source: 'policy' });
});

test('the warning fires once, with its wording, when no repository answers; the reason names git\'s own line', () => {
  const dir = fs.realpathSync(scratchDir('ct-nogit-'));
  const { entry, writes } = entryWithStderr(dir);
  assert.deepStrictEqual(entry, INVALID_ENTRY);
  assert.strictEqual(writes.length, 1);
  assert.match(writes[0], WARNING);
  assert.ok(!writes[0].includes('read failed: error'), writes[0]);
  assert.ok(/not a git repository|git exited/.test(writes[0]), writes[0]);
});

test('the mixed-key real call: a worktree [] never reaches protected-paths, merge-sensitive-paths still resolves', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'rec');
  writePolicy(wt, 'protected-paths: []\n');
  const saved = process.cwd();
  process.chdir(wt);
  let out;
  try { out = defaultResolvePolicy(['merge-sensitive-paths', 'protected-paths']); } finally { process.chdir(saved); }
  assert.deepStrictEqual(out['protected-paths'], { value: [], source: 'default' });
  assert.ok(out['merge-sensitive-paths'], 'merge-sensitive-paths entry present');
});

test('protectedPathGlobsOf keys on invalid and source, from real resolver replies', () => {
  const entry = (policyRaw) => resolvePolicyKeys(['protected-paths'], { policyRaw })['protected-paths'];
  assert.deepStrictEqual(protectedPathGlobsOf(entry('protected-paths: ""\n')), SHIPPED_PROTECTED_PATHS);
  assert.deepStrictEqual(protectedPathGlobsOf(entry('protected-paths: []\n')), []);
  assert.deepStrictEqual(protectedPathGlobsOf(entry('protected-paths: infra/**, **/package.json\n')), ['infra/**', '**/package.json']);
  assert.deepStrictEqual(protectedPathGlobsOf(entry('protected-paths: ["infra/**"]\n')), SHIPPED_PROTECTED_PATHS);
  for (const e of [undefined, { value: undefined, source: 'policy' }, { value: 'a b', source: 'policy' }]) {
    assert.deepStrictEqual(protectedPathGlobsOf(e), SHIPPED_PROTECTED_PATHS, JSON.stringify(e));
  }
});
