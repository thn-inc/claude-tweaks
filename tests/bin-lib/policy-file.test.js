'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitRepo, linkedWorktreeOf, fixtureGit } = require('../helpers/git-fixtures');
const { POLICY_REL_PATH, isLinkedWorktreeRoot, locatePolicyFile } = require('../../plugin/bin/lib/policy-file');

const WT = path.join(path.sep, 'proj', 'wt');
const MAIN = path.join(path.sep, 'proj', 'main');
const own = path.join(WT, POLICY_REL_PATH);
const mainPolicy = path.join(MAIN, POLICY_REL_PATH);

// An fsImpl whose lstatSync answers from a Map of path -> 'file' | 'dir' | 'symlink' | Error.
// readFileSync answers the worktree's `.git` file (a direct child of MAIN/.git/worktrees);
// realpathSync is the identity.
function fakeFs(entries) {
  return {
    readFileSync: () => `gitdir: ${path.join(MAIN, '.git', 'worktrees', 'wt')}\n`,
    realpathSync: (p) => p,
    lstatSync(p) {
      const v = entries.get(p);
      if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      if (v instanceof Error) throw v;
      return {
        isSymbolicLink: () => v === 'symlink',
        isFile: () => v === 'file',
        isDirectory: () => v === 'dir',
      };
    },
  };
}

function stub(result) {
  const calls = [];
  const fn = (p) => {
    calls.push(p);
    if (result instanceof Error) throw result;
    return result;
  };
  fn.calls = calls;
  return fn;
}

const gitFile = path.join(WT, '.git');

test('locator seam: worktree file present — returns the worktree\'s own path, source checkout, mainCheckoutRoot never called', () => {
  const mainCheckoutRoot = stub(MAIN);
  const fsImpl = fakeFs(new Map([[gitFile, 'file'], [own, 'file'], [mainPolicy, 'file']]));
  assert.deepStrictEqual(locatePolicyFile(WT, { fsImpl, mainCheckoutRoot }), { path: own, source: 'checkout' });
  assert.strictEqual(mainCheckoutRoot.calls.length, 0);
});

test('locator seam: worktree file absent, main present — returns the main checkout\'s path, source main-checkout', () => {
  const mainCheckoutRoot = stub(MAIN);
  const fsImpl = fakeFs(new Map([[gitFile, 'file'], [mainPolicy, 'file']]));
  assert.deepStrictEqual(locatePolicyFile(WT, { fsImpl, mainCheckoutRoot }), { path: mainPolicy, source: 'main-checkout' });
});

test('locator seam: both absent — returns the worktree\'s own path, source checkout', () => {
  const mainCheckoutRoot = stub(MAIN);
  const fsImpl = fakeFs(new Map([[gitFile, 'file']]));
  assert.deepStrictEqual(locatePolicyFile(WT, { fsImpl, mainCheckoutRoot }), { path: own, source: 'checkout' });
});

test('AC3.1: main checkout, file absent — .git is a directory, no fallback, mainCheckoutRoot never called', () => {
  const mainCheckoutRoot = stub(MAIN);
  const fsImpl = fakeFs(new Map([[gitFile, 'dir'], [mainPolicy, 'file']]));
  assert.deepStrictEqual(locatePolicyFile(WT, { fsImpl, mainCheckoutRoot }), { path: own, source: 'checkout' });
  assert.strictEqual(mainCheckoutRoot.calls.length, 0);
});

test('submodule: .git file but mainCheckoutRoot returns null — own path, source checkout', () => {
  const mainCheckoutRoot = stub(null);
  const fsImpl = fakeFs(new Map([[gitFile, 'file'], [mainPolicy, 'file']]));
  assert.deepStrictEqual(locatePolicyFile(WT, { fsImpl, mainCheckoutRoot }), { path: own, source: 'checkout' });
});

test('own file unreadable (EACCES) or a symlink — treated as present, no fallback', () => {
  for (const v of [Object.assign(new Error('EACCES'), { code: 'EACCES' }), 'symlink']) {
    const mainCheckoutRoot = stub(MAIN);
    const fsImpl = fakeFs(new Map([[gitFile, 'file'], [own, v], [mainPolicy, 'file']]));
    assert.deepStrictEqual(locatePolicyFile(WT, { fsImpl, mainCheckoutRoot }), { path: own, source: 'checkout' });
    assert.strictEqual(mainCheckoutRoot.calls.length, 0);
  }
});

test('a throwing mainCheckoutRoot — own path, source checkout, no throw', () => {
  const mainCheckoutRoot = stub(new Error('boom'));
  const fsImpl = fakeFs(new Map([[gitFile, 'file'], [mainPolicy, 'file']]));
  assert.deepStrictEqual(locatePolicyFile(WT, { fsImpl, mainCheckoutRoot }), { path: own, source: 'checkout' });
});

test('non-string root — { path: null, source: \'checkout\' }', () => {
  for (const bad of [null, undefined, 42, {}]) {
    assert.deepStrictEqual(locatePolicyFile(bad), { path: null, source: 'checkout' });
  }
});

test('isLinkedWorktreeRoot: true for a .git file with a main root; false for a .git directory, a missing .git, and a null main root', () => {
  const yes = stub(MAIN);
  assert.strictEqual(isLinkedWorktreeRoot(WT, { fsImpl: fakeFs(new Map([[gitFile, 'file']])), mainCheckoutRoot: yes }), true);
  assert.strictEqual(isLinkedWorktreeRoot(WT, { fsImpl: fakeFs(new Map([[gitFile, 'dir']])), mainCheckoutRoot: stub(MAIN) }), false);
  assert.strictEqual(isLinkedWorktreeRoot(WT, { fsImpl: fakeFs(new Map()), mainCheckoutRoot: stub(MAIN) }), false);
  assert.strictEqual(isLinkedWorktreeRoot(WT, { fsImpl: fakeFs(new Map([[gitFile, 'file']])), mainCheckoutRoot: stub(null) }), false);
});

test('isLinkedWorktreeRoot: a throwing mainCheckoutRoot seam — false, no throw', () => {
  const fsImpl = fakeFs(new Map([[gitFile, 'file']]));
  assert.strictEqual(isLinkedWorktreeRoot(WT, { fsImpl, mainCheckoutRoot: stub(new Error('boom')) }), false);
});

// Real-fs: a hand-built main repo (.git dir with worktrees/wt) and a worktree whose .git file points at it.
function realLayout(t, gitdirFor) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const main = path.join(base, 'main');
  const wt = path.join(base, 'wt');
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, POLICY_REL_PATH), 'k: v\n');
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitdirFor(main)}\n`);
  return { main, wt };
}

test('real fs: absolute gitdir — worktree without policy.yml reads main\'s', (t) => {
  const { main, wt } = realLayout(t, (m) => path.join(m, '.git', 'worktrees', 'wt'));
  assert.deepStrictEqual(locatePolicyFile(wt), {
    path: path.join(fs.realpathSync(main), POLICY_REL_PATH),
    source: 'main-checkout',
  });
});

test('real fs: relative gitdir (gitdir: ../main/.git/worktrees/wt) — still resolves main\'s', (t) => {
  const { main, wt } = realLayout(t, () => '../main/.git/worktrees/wt');
  assert.deepStrictEqual(locatePolicyFile(wt), {
    path: path.join(fs.realpathSync(main), POLICY_REL_PATH),
    source: 'main-checkout',
  });
});

// Real git: a submodule initialized inside a linked worktree has a .git file naming
// <main>/.git/worktrees/<wt>/modules/<name> — not a linked worktree, and its own policy wins.
test('real git: a submodule inside a linked worktree is not a linked worktree; the worktree itself still falls back', (t) => {
  const main = gitRepo();
  const subSrc = gitRepo();
  t.after(() => { fs.rmSync(main, { recursive: true, force: true }); fs.rmSync(subSrc, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, POLICY_REL_PATH), 'worktree-always: true\nintegration-branch: develop\n');
  fs.writeFileSync(path.join(main, '.gitignore'), '.claude-tweaks/\n');
  fixtureGit(['-C', main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', subSrc, 'sub']);
  fixtureGit(['-C', main, 'add', '.gitignore', '.gitmodules', 'sub']);
  fixtureGit(['-C', main, 'commit', '-q', '-m', 'add sub']);
  const wt = linkedWorktreeOf(main);
  t.after(() => fs.rmSync(path.dirname(wt), { recursive: true, force: true }));
  fixtureGit(['-C', wt, '-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '-q']);
  const sub = path.join(wt, 'sub');
  assert.ok(fs.statSync(path.join(sub, '.git')).isFile());
  assert.match(fs.readFileSync(path.join(sub, '.git'), 'utf8'), /worktrees[\\/][^\\/]+[\\/]modules/);
  assert.deepStrictEqual(locatePolicyFile(sub), { path: path.join(sub, POLICY_REL_PATH), source: 'checkout' });
  assert.strictEqual(isLinkedWorktreeRoot(sub), false);
  assert.deepStrictEqual(locatePolicyFile(wt), { path: path.join(main, POLICY_REL_PATH), source: 'main-checkout' });
  assert.strictEqual(isLinkedWorktreeRoot(wt), true);
});
