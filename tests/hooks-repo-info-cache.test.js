'use strict';
// #5294: repoInfo's per-process memo, validated by a filesystem signature
// (plugin/bin/lib/hooks/repo-info-cache.js). Each test counts the `git
// rev-parse` spawns repoInfo makes by wrapping child_process.execFileSync,
// which git-exec reaches by property access at call time.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Pinned before the module loads: harmless until the cross-process store
// lands, and keeps that store out of the real per-user location once it does.
process.env.CT_HOOKS_REPO_INFO_STORE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ric-store-')), 'store.json');

const cp = require('child_process');
const { repoInfo } = require('../plugin/bin/lib/hooks/worktree-detect');
const { resetMemo } = require('../plugin/bin/lib/hooks/repo-info-cache');
const { gitRepo, linkedWorktreeOf, fixtureGit } = require('./helpers/git-fixtures');

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
  resetMemo();
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
  resetMemo();
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
  resetMemo();
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
  resetMemo();
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ric-nongit-')));
  const counter = countRevParse(t);
  assert.deepStrictEqual(repoInfo(dir), { repoRoot: null, isLinkedWorktree: false, indeterminate: false });
  fixtureGit(['init', '-q', dir]);
  const after = repoInfo(dir);
  assert.strictEqual(counter.n, 2);
  assert.strictEqual(after.repoRoot, fs.realpathSync(dir));
});

test('AC3.4: a pruned worktree admin dir with the .git file kept is re-asked', (t) => {
  resetMemo();
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
  resetMemo();
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const globalCfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ric-gcfg-')), 'gitconfig');
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

test('AC4.1: an indeterminate answer is never cached and the next call answers definitively', (t) => {
  resetMemo();
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

  // (b) a timeout on the memo path itself is not remembered.
  resetMemo();
  failing = true;
  assert.strictEqual(repoInfo(wt).indeterminate, true);
  failing = false;
  const spawnedBefore = counter.n;
  const next = repoInfo(wt);
  assert.deepStrictEqual(next, { repoRoot: wt, isLinkedWorktree: true, indeterminate: false });
  assert.ok(counter.n > spawnedBefore, 'the call after an indeterminate one spawned git');
});

test('#5294: a call with opts bypasses the memo', (t) => {
  resetMemo();
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const counter = countRevParse(t);
  repoInfo(wt);
  repoInfo(wt, { timeoutMs: 10000 });
  assert.strictEqual(counter.n, 2);
});

test('#5294: ordinary git activity keeps the cache warm', (t) => {
  resetMemo();
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
