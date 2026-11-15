'use strict';
// #5294: repoInfo's per-process memo, validated by a filesystem signature
// (plugin/bin/lib/hooks/repo-info-cache.js). Each test counts the `git
// rev-parse` spawns repoInfo makes by wrapping child_process.execFileSync,
// which git-exec reaches by property access at call time.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cp = require('child_process');
const { repoInfo } = require('../plugin/bin/lib/hooks/worktree-detect');
const { resetMemo, lookupRepoInfo, rememberRepoInfo, repoSignature } = require('../plugin/bin/lib/hooks/repo-info-cache');
const { gitRepo, linkedWorktreeOf, fixtureGit } = require('./helpers/git-fixtures');
const { isolateRepoInfoCache } = require('./helpers/repo-info-cache');

// Temp dirs this file creates itself (each test's store is the helper's).
const scratchDirs = [];
after(() => {
  for (const d of scratchDirs) fs.rmSync(d, { recursive: true, force: true });
});
const scratchDir = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  scratchDirs.push(d);
  return d;
};

// Installs a counting passthrough over execFileSync. `fail()` returning an
// error makes every call throw it instead (the indeterminate case).
function countRevParse(t, fail = () => null) {
  const real = cp.execFileSync;
  const counter = { n: 0 };
  t.mock.method(cp, 'execFileSync', (file, args, opts) => {
    if (Array.isArray(args) && args.includes('rev-parse')) counter.n++;
    const err = fail();
    if (err) throw err;
    return real.call(cp, file, args, opts);
  });
  return counter;
}

// The bypass path: an opts key skips the memo, so this is the uncached answer.
const fresh = (p) => repoInfo(p, { timeoutMs: 10000 });

function adminDirOf(wt) {
  const raw = fs.readFileSync(path.join(wt, '.git'), 'utf8');
  return path.resolve(wt, /^gitdir:\s*(.+?)\s*$/m.exec(raw)[1]);
}

test('AC1.1: repeated repoInfo calls on one directory spawn git once', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const counter = countRevParse(t);
  const expected = { repoRoot: wt, isLinkedWorktree: true, indeterminate: false };
  const first = repoInfo(wt);
  assert.deepStrictEqual(first, expected);
  first.repoRoot = 'mutated';
  first.isLinkedWorktree = false;
  assert.deepStrictEqual(repoInfo(wt), expected);
  assert.deepStrictEqual(repoInfo(wt), expected);
  assert.strictEqual(counter.n, 1);
});

test('AC3.1: a removed linked worktree is re-asked', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const counter = countRevParse(t);
  repoInfo(wt);
  fixtureGit(['-C', main, 'worktree', 'remove', '--force', wt]);
  fs.mkdirSync(wt);
  const after = repoInfo(wt);
  assert.strictEqual(counter.n, 2);
  assert.deepStrictEqual(after, fresh(wt));
});

test('AC3.2: a worktree removed and re-added at the same path is re-asked', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const counter = countRevParse(t);
  repoInfo(wt);
  fixtureGit(['-C', main, 'worktree', 'remove', '--force', wt]);
  fixtureGit(['-C', main, 'worktree', 'add', '-q', '--detach', wt]);
  const after = repoInfo(wt);
  assert.strictEqual(counter.n, 2);
  assert.deepStrictEqual(after, fresh(wt));
});

test('AC3.3: git init in a directory that was not a repo is re-asked', (t) => {
  isolateRepoInfoCache(t);
  const dir = scratchDir('ct-ric-nongit-');
  const counter = countRevParse(t);
  assert.deepStrictEqual(repoInfo(dir), { repoRoot: null, isLinkedWorktree: false, indeterminate: false });
  fixtureGit(['init', '-q', dir]);
  const after = repoInfo(dir);
  assert.strictEqual(counter.n, 2);
  assert.strictEqual(after.repoRoot, fs.realpathSync(dir));
});

test('AC3.4: a pruned worktree admin dir with the .git file kept is re-asked', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const admin = adminDirOf(wt);
  const counter = countRevParse(t);
  repoInfo(wt);
  fs.rmSync(path.join(main, '.git', 'worktrees', path.basename(admin)), { recursive: true, force: true });
  const after = repoInfo(wt);
  assert.strictEqual(counter.n, 2);
  assert.deepStrictEqual(after, fresh(wt));
});

test('#5294: an edited global git config is re-asked', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const globalCfg = path.join(scratchDir('ct-ric-gcfg-'), 'gitconfig');
  fs.writeFileSync(globalCfg, '');
  const prior = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalCfg;
  try {
    const counter = countRevParse(t);
    repoInfo(wt);
    fs.appendFileSync(globalCfg, '[user]\n\tname = x\n');
    repoInfo(wt);
    assert.strictEqual(counter.n, 2);
  } finally {
    if (prior === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = prior;
  }
});

test('#5294: with HOME unset, an edited USERPROFILE .gitconfig is re-asked', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const profile = scratchDir('ct-ric-profile-');
  const gitconfig = path.join(profile, '.gitconfig');
  fs.writeFileSync(gitconfig, '');
  const names = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL'];
  const prior = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  delete process.env.HOME;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.GIT_CONFIG_GLOBAL;
  process.env.USERPROFILE = profile;
  try {
    const counter = countRevParse(t);
    repoInfo(wt);
    fs.appendFileSync(gitconfig, '[user]\n\tname = x\n');
    repoInfo(wt);
    assert.strictEqual(counter.n, 2);
  } finally {
    for (const n of names) {
      if (prior[n] === undefined) delete process.env[n];
      else process.env[n] = prior[n];
    }
  }
});

test('#5294: a written main-checkout config.worktree is re-asked', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const counter = countRevParse(t);
  repoInfo(main);
  fs.writeFileSync(path.join(main, '.git', 'config.worktree'), '[core]\n\tbare = false\n');
  const after = repoInfo(main);
  assert.strictEqual(counter.n, 2);
  assert.deepStrictEqual(after, fresh(main));
});

test('AC4.1: an indeterminate answer is never cached and the next call answers definitively', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);

  // (a) a timeout through the opts path, then a normal call.
  repoInfo(wt, { timeoutMs: 1 });
  let failing = false;
  const counter = countRevParse(t, () => (failing
    ? Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' })
    : null));
  const before = counter.n;
  const definitive = repoInfo(wt);
  assert.strictEqual(definitive.indeterminate, false);
  assert.ok(counter.n - before >= 1, 'the normal call spawned git');

  // (b) a timeout on the memo path itself is not remembered. (a)'s normal call
  // was remembered, so empty the memo and this test's store first.
  resetMemo();
  fs.rmSync(process.env.CT_HOOKS_REPO_INFO_STORE, { force: true });
  failing = true;
  assert.strictEqual(repoInfo(wt).indeterminate, true);
  failing = false;
  const spawnedBefore = counter.n;
  const next = repoInfo(wt);
  assert.deepStrictEqual(next, { repoRoot: wt, isLinkedWorktree: true, indeterminate: false });
  assert.ok(counter.n > spawnedBefore, 'the call after an indeterminate one spawned git');
});

test('#5294: git\'s own "not a git repository" answer is remembered', (t) => {
  isolateRepoInfoCache(t);
  const dir = scratchDir('ct-ric-nongit-');
  const counter = countRevParse(t);
  const negative = { repoRoot: null, isLinkedWorktree: false, indeterminate: false };
  assert.deepStrictEqual(repoInfo(dir), negative);
  assert.deepStrictEqual(repoInfo(dir), negative);
  assert.strictEqual(counter.n, 1);
});

test('#5294: a git killed by a signal is answered as today but not remembered', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  let killing = true;
  const counter = countRevParse(t, () => (killing
    ? Object.assign(new Error('Command failed: git rev-parse'), { status: null, signal: 'SIGKILL', stderr: '' })
    : null));
  // The returned answer is unchanged: git-error is a definitive negative (#134).
  assert.deepStrictEqual(repoInfo(main), { repoRoot: null, isLinkedWorktree: false, indeterminate: false });
  killing = false;
  assert.deepStrictEqual(repoInfo(main), { repoRoot: main, isLinkedWorktree: false, indeterminate: false });
  assert.strictEqual(counter.n, 2, 'the call after the killed git spawned git');
});

test('#5294: a directory reached through a symlink into a repo subdirectory is re-asked once the repo is gone', (t) => {
  isolateRepoInfoCache(t);
  const base = scratchDir('ct-ric-link-');
  const repo = path.join(base, 'repo');
  fixtureGit(['init', '-q', repo]);
  fs.mkdirSync(path.join(repo, 'inner'));
  const link = path.join(base, 'link');
  fs.symlinkSync(path.join(repo, 'inner'), link, 'dir');
  const counter = countRevParse(t);
  assert.strictEqual(repoInfo(link).repoRoot, repo);
  fs.rmSync(path.join(repo, '.git'), { recursive: true, force: true });
  const after = repoInfo(link);
  assert.strictEqual(counter.n, 2);
  assert.deepStrictEqual(after, fresh(link));
});

test('#5294: an entry remembered under one uid does not answer another', (t) => {
  isolateRepoInfoCache(t);
  const dir = scratchDir('ct-ric-uid-');
  const signature = repoSignature(dir);
  const answer = { repoRoot: null, isLinkedWorktree: false, indeterminate: false };
  rememberRepoInfo(dir, process.env, signature, answer, 1001);
  assert.strictEqual(lookupRepoInfo(dir, process.env, 0).answer, null, 'memo: another uid misses');
  resetMemo();
  assert.strictEqual(lookupRepoInfo(dir, process.env, 0).answer, null, 'store: another uid misses');
  assert.deepStrictEqual(lookupRepoInfo(dir, process.env, 1001).answer, answer, 'the same uid hits');
});

test('#5294: a cache lookup that throws falls back to git', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const counter = countRevParse(t);
  repoInfo(main); // warm the memo, so the next lookup compares signatures
  const stringify = t.mock.method(JSON, 'stringify', () => { throw new Error('cache fault'); });
  let got;
  try {
    got = repoInfo(main);
  } finally {
    stringify.mock.restore();
  }
  assert.deepStrictEqual(got, { repoRoot: main, isLinkedWorktree: false, indeterminate: false });
  assert.strictEqual(counter.n, 2);
});

test('#5294: a call with opts bypasses the memo', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const counter = countRevParse(t);
  repoInfo(wt);
  repoInfo(wt, { timeoutMs: 10000 });
  assert.strictEqual(counter.n, 2);
});

test('#5294: ordinary git activity keeps the cache warm', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const admin = adminDirOf(wt);
  const counter = countRevParse(t);
  repoInfo(wt);
  repoInfo(main);
  assert.strictEqual(counter.n, 2);
  for (const gitDir of [admin, path.join(main, '.git')]) {
    const lock = path.join(gitDir, 'index.lock');
    fs.writeFileSync(lock, '');
    fs.renameSync(lock, path.join(gitDir, 'index.lock.done'));
  }
  fs.writeFileSync(path.join(wt, 'out.txt'), 'x');
  fs.writeFileSync(path.join(main, 'out.txt'), 'x');
  assert.deepStrictEqual(repoInfo(wt), { repoRoot: wt, isLinkedWorktree: true, indeterminate: false });
  assert.deepStrictEqual(repoInfo(main), { repoRoot: main, isLinkedWorktree: false, indeterminate: false });
  assert.strictEqual(counter.n, 2);
});
