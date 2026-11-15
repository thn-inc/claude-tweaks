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
const {
  resetMemo, lookupRepoInfo, rememberRepoInfo, repoSignature, storePath, storeBypassed,
} = require('../plugin/bin/lib/hooks/repo-info-cache');
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

test('#5294: a "not a repo" answer for a .git git rejects is not remembered', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const head = path.join(main, '.git', 'HEAD');
  const saved = fs.readFileSync(head);
  fs.rmSync(head);
  const counter = countRevParse(t);
  assert.strictEqual(repoInfo(main).repoRoot, null);
  fs.writeFileSync(head, saved);
  assert.deepStrictEqual(repoInfo(main), { repoRoot: main, isLinkedWorktree: false, indeterminate: false });
  assert.strictEqual(counter.n, 2, 'the call after HEAD was restored spawned git');
});

test('#5294: an answer naming an enclosing repo is not remembered for a rejected inner .git', (t) => {
  isolateRepoInfoCache(t);
  const outer = gitRepo();
  const inner = path.join(outer, 'inner');
  fixtureGit(['init', '-q', inner]);
  const head = path.join(inner, '.git', 'HEAD');
  const saved = fs.readFileSync(head);
  fs.rmSync(head);
  const counter = countRevParse(t);
  const broken = repoInfo(inner);
  fs.writeFileSync(head, saved);
  assert.deepStrictEqual(repoInfo(inner), { repoRoot: fs.realpathSync(inner), isLinkedWorktree: false, indeterminate: false });
  assert.strictEqual(counter.n, 2, `the call after HEAD was restored spawned git (first answer: ${JSON.stringify(broken)})`);
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

// The cache reads process.getuid() once per lookup and once per remember (each
// entry point's default `uid`), so replacing it is a fault seam into either
// step. `throwOn(callNo)` decides, per 1-based call, whether to throw; it is
// installed whether or not the platform has getuid (win32 does not).
function uidSeam(t, throwOn = () => false) {
  const had = Object.prototype.hasOwnProperty.call(process, 'getuid');
  const original = process.getuid;
  const seam = { calls: 0 };
  process.getuid = () => {
    seam.calls++;
    if (throwOn(seam.calls)) throw new Error('cache fault');
    return 4242;
  };
  t.after(() => {
    if (had) process.getuid = original;
    else delete process.getuid;
  });
  return seam;
}

test('#5294: rememberRepoInfo drops an indeterminate answer', (t) => {
  isolateRepoInfoCache(t);
  const dir = scratchDir('ct-ric-indet-');
  rememberRepoInfo(dir, process.env, repoSignature(dir), { repoRoot: null, isLinkedWorktree: false, indeterminate: true });
  assert.strictEqual(lookupRepoInfo(dir).answer, null, 'nothing in the memo');
  assert.strictEqual(fs.existsSync(process.env.CT_HOOKS_REPO_INFO_STORE), false, 'nothing written to the store');
});

test('#5294: an indeterminate failure is not remembered even when it carries a not-a-repo exit', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const seam = uidSeam(t);
  let failing = true;
  const counter = countRevParse(t, () => (failing
    ? Object.assign(new Error('spawnSync git ETIMEDOUT'), {
      code: 'ETIMEDOUT', status: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git',
    })
    : null));
  assert.deepStrictEqual(repoInfo(main), { repoRoot: null, isLinkedWorktree: false, indeterminate: true });
  assert.strictEqual(seam.calls, 1, 'only the lookup ran; repoInfo never tried to remember');
  failing = false;
  assert.deepStrictEqual(repoInfo(main), { repoRoot: main, isLinkedWorktree: false, indeterminate: false });
  assert.strictEqual(counter.n, 2, 'the call after the indeterminate one spawned git');
});

test('#5294: a cache lookup that throws falls back to git and remembers nothing', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const counter = countRevParse(t);
  uidSeam(t, (n) => n === 1); // the lookup throws; the remember after the spawn does not
  const got = repoInfo(main);
  assert.deepStrictEqual(got, { repoRoot: main, isLinkedWorktree: false, indeterminate: false });
  assert.strictEqual(counter.n, 1);
  // The remember ran with the null signature the failed lookup left: it must store nothing.
  assert.strictEqual(fs.existsSync(process.env.CT_HOOKS_REPO_INFO_STORE), false, 'no store entry under a null signature');
  repoInfo(main);
  assert.strictEqual(counter.n, 2, 'no memo entry either: the next call spawned');
});

test('#5294: a cache remember that throws still returns git\'s answer', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const counter = countRevParse(t);
  uidSeam(t, (n) => n === 2); // the lookup succeeds (a miss); the remember throws
  assert.deepStrictEqual(repoInfo(main), { repoRoot: main, isLinkedWorktree: false, indeterminate: false });
  assert.strictEqual(counter.n, 1);
  assert.strictEqual(fs.existsSync(process.env.CT_HOOKS_REPO_INFO_STORE), false, 'nothing was stored');
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

// ---- #5294 review: stale answers ----------------------------------------------

test('#5294 review: a gitlink added to the enclosing repo\'s index re-asks a nested linked worktree', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = path.join(main, 'inner-wt');
  fixtureGit(['-C', main, 'worktree', 'add', '-q', wt, '-b', `inner-${path.basename(main)}`]);
  assert.strictEqual(repoInfo(wt).isLinkedWorktree, true);
  const sha = fixtureGit(['-C', main, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  fixtureGit(['-C', main, 'update-index', '--add', '--cacheinfo', `160000,${sha},inner-wt`]);
  const expected = fresh(wt);
  assert.strictEqual(expected.isLinkedWorktree, false, 'git now sees a superproject');
  assert.deepStrictEqual(repoInfo(wt), expected);
});

test('#5294 review: a cached plain repo that loses .git/HEAD is re-asked', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  assert.strictEqual(repoInfo(main).repoRoot, main);
  fs.rmSync(path.join(main, '.git', 'HEAD'));
  assert.deepStrictEqual(repoInfo(main), fresh(main));
});

test('#5294 review: a cached linked worktree whose admin dir loses HEAD is re-asked', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  assert.strictEqual(repoInfo(wt).isLinkedWorktree, true);
  fs.rmSync(path.join(adminDirOf(wt), 'HEAD'));
  assert.deepStrictEqual(repoInfo(wt), fresh(wt));
});

test('#5294 review: a commondir written into a main checkout\'s .git is re-asked', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const other = gitRepo();
  assert.strictEqual(repoInfo(main).isLinkedWorktree, false);
  fs.writeFileSync(path.join(main, '.git', 'commondir'), `${path.join(other, '.git')}\n`);
  const expected = fresh(main);
  assert.strictEqual(expected.isLinkedWorktree, true, 'git now treats the git dir as a linked worktree');
  assert.deepStrictEqual(repoInfo(main), expected);
});

test('#5294 review: a symlink retargeted inside one repo is re-asked', (t) => {
  isolateRepoInfoCache(t);
  const base = scratchDir('ct-ric-retarget-');
  const repo = path.join(base, 'repo');
  fixtureGit(['init', '-q', repo]);
  fs.mkdirSync(path.join(repo, 'sub'));
  const link = path.join(base, 'link');
  fs.symlinkSync(path.join(repo, 'sub'), link, 'dir');
  const counter = countRevParse(t);
  repoInfo(link);
  fs.unlinkSync(link);
  fs.symlinkSync(repo, link, 'dir');
  const after = repoInfo(link);
  // git gives the same toplevel for both targets; what matters is that a
  // different directory is never answered from the old one's entry.
  assert.strictEqual(counter.n, 2, 'the retargeted link spawned git');
  assert.deepStrictEqual(after, fresh(link));
});

// ---- #5294 review: signature components --------------------------------------

test('#5294 review: the Homebrew system configs are tracked off win32', (t) => {
  isolateRepoInfoCache(t);
  const dir = scratchDir('ct-ric-sys-');
  const tracked = repoSignature(dir, { HOME: dir }, 'darwin').configs.map(([p]) => p);
  for (const p of ['/etc/gitconfig', '/opt/homebrew/etc/gitconfig', '/usr/local/etc/gitconfig']) {
    assert.ok(tracked.includes(p), `${p} is tracked (got ${JSON.stringify(tracked)})`);
  }
});

test('#5294 review: a linked worktree\'s commondir text is part of the signature', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const before = repoSignature(wt);
  fs.writeFileSync(path.join(adminDirOf(wt), 'commondir'), `${path.join(main, '.git')}\n`);
  assert.notDeepStrictEqual(repoSignature(wt), before);
});

test('#5294 review: a linked worktree\'s common config is part of the signature', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const before = repoSignature(wt);
  fs.appendFileSync(path.join(main, '.git', 'config'), '[user]\n\tname = x\n');
  assert.notDeepStrictEqual(repoSignature(wt), before);
});

test('#5294 review: a linked worktree\'s admin config.worktree is part of the signature', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const before = repoSignature(wt);
  fs.writeFileSync(path.join(adminDirOf(wt), 'config.worktree'), '[core]\n\tbare = false\n');
  assert.notDeepStrictEqual(repoSignature(wt), before);
});

test('#5294 review: the XDG_CONFIG_HOME global config is part of the signature', (t) => {
  isolateRepoInfoCache(t);
  const main = gitRepo();
  const xdg = scratchDir('ct-ric-xdg-');
  const env = { HOME: xdg, XDG_CONFIG_HOME: xdg };
  const before = repoSignature(main, env);
  fs.mkdirSync(path.join(xdg, 'git'));
  fs.writeFileSync(path.join(xdg, 'git', 'config'), '[user]\n\tname = x\n');
  assert.notDeepStrictEqual(repoSignature(main, env), before);
});

// ---- #5294 review: the store -------------------------------------------------

test('#5294 review: a store entry whose answer names another root is a miss', (t) => {
  isolateRepoInfoCache(t);
  const dir = scratchDir('ct-ric-edited-');
  const elsewhere = gitRepo();
  const answer = { repoRoot: null, isLinkedWorktree: false, indeterminate: false };
  rememberRepoInfo(dir, process.env, repoSignature(dir), answer);
  const file = process.env.CT_HOOKS_REPO_INFO_STORE;
  const store = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of Object.keys(store.entries)) store.entries[k].answer.repoRoot = elsewhere;
  fs.writeFileSync(file, JSON.stringify(store));
  resetMemo();
  assert.strictEqual(lookupRepoInfo(dir).answer, null);
});

test('#5294 review: the store file is created readable by its owner only', { skip: process.platform === 'win32' }, (t) => {
  isolateRepoInfoCache(t);
  const dir = scratchDir('ct-ric-mode-');
  rememberRepoInfo(dir, process.env, repoSignature(dir), { repoRoot: null, isLinkedWorktree: false, indeterminate: false });
  const mode = fs.statSync(process.env.CT_HOOKS_REPO_INFO_STORE).mode & 0o777;
  assert.strictEqual(mode, 0o600, `mode ${mode.toString(8)}`);
});

// A writer killed mid-write leaves its temp file behind; a later process with
// the same pid writes into it, and writeFileSync keeps an existing file's mode.
test('#5294 review: a leftover temp file does not lend the store its mode', { skip: process.platform === 'win32' }, (t) => {
  isolateRepoInfoCache(t);
  const dir = scratchDir('ct-ric-mode-tmp-');
  const file = process.env.CT_HOOKS_REPO_INFO_STORE;
  fs.writeFileSync(`${file}.tmp-${process.pid}`, 'left behind', { mode: 0o644 });
  rememberRepoInfo(dir, process.env, repoSignature(dir), { repoRoot: null, isLinkedWorktree: false, indeterminate: false });
  const mode = fs.statSync(file).mode & 0o777;
  assert.strictEqual(mode, 0o600, `mode ${mode.toString(8)}`);
});

test('#5294 review: a relative CT_HOOKS_REPO_INFO_STORE turns the store off', (t) => {
  const relative = path.join('rel', 'store.json');
  const absolute = path.join(os.tmpdir(), 'abs-store.json');
  assert.strictEqual(storeBypassed({ CT_HOOKS_REPO_INFO_STORE: relative }), true);
  assert.strictEqual(storeBypassed({ CT_HOOKS_REPO_INFO_STORE: absolute }), false);
  assert.strictEqual(storePath({ CT_HOOKS_REPO_INFO_STORE: absolute }), absolute);

  // End to end: with a relative value nothing is written, here or at home.
  isolateRepoInfoCache(t);
  const isolated = process.env.CT_HOOKS_REPO_INFO_STORE;
  const cwd = fs.realpathSync(scratchDir('ct-ric-rel-'));
  const env = { ...process.env, CT_HOOKS_REPO_INFO_STORE: relative };
  const prior = process.cwd();
  process.chdir(cwd);
  try {
    rememberRepoInfo(cwd, env, repoSignature(cwd, env), { repoRoot: null, isLinkedWorktree: false, indeterminate: false });
  } finally {
    process.chdir(prior);
  }
  assert.strictEqual(fs.existsSync(path.join(cwd, relative)), false, 'no store file under the cwd');
  assert.strictEqual(fs.existsSync(isolated), false, 'the isolated store was not written either');
  assert.strictEqual(lookupRepoInfo(cwd, env).answer.repoRoot, null, 'the memo still answers');
});

test('#5294 review: isolateRepoInfoCache removes the git discovery variables for the test', async (t) => {
  const names = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM'];
  const prior = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names) process.env[n] = `sentinel-${n}`;
  try {
    await t.test('inside', (st) => {
      isolateRepoInfoCache(st);
      for (const n of names) assert.strictEqual(process.env[n], undefined, `${n} is removed`);
    });
    for (const n of names) assert.strictEqual(process.env[n], `sentinel-${n}`, `${n} is restored`);
  } finally {
    for (const n of names) {
      if (prior[n] === undefined) delete process.env[n];
      else process.env[n] = prior[n];
    }
  }
});
