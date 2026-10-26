'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { selectEntry, readInstalledPlugins, canonicalGitRoot } = require('../../plugin/bin/lib/installed-plugins');
const { readText } = require('../helpers/read-skill');

// #3541: selectEntry follows Claude Code's first-applicable-in-file-order rule
// (read from 2.1.302). These tests pin that rule against real temp directories
// and a deps.readFile that reads the real files, so the .git resolution runs the
// same code path the resolvers use.

function tmpRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'installed-plugins-test-')));
}

function mkdirs(...dirs) {
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
}

// A plain checkout: .git is a directory.
function gitCheckout(dir) {
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
}

// A linked worktree `wt` of the checkout `main`: a .git file whose gitdir holds a commondir.
function linkedWorktree(main, wt) {
  const gitdir = path.join(main, '.git', 'worktrees', 'w');
  mkdirs(gitdir, wt);
  fs.writeFileSync(path.join(gitdir, 'commondir'), '../..\n');
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitdir}\n`);
}

const user = { scope: 'user', installPath: '/u' };
const managed = { scope: 'managed', installPath: '/m' };
const project = (projectPath) => ({ scope: 'project', projectPath, installPath: `/p${projectPath}` });
const local = (projectPath) => ({ scope: 'local', projectPath, installPath: `/l${projectPath}` });

const deps = { realpath: fs.realpathSync, readFile: (p) => fs.readFileSync(p, 'utf8') };

test('AC1.1: file order decides — [user, project(P)] -> user; [project(P), user] -> project(P)', () => {
  const root = tmpRoot();
  const P = path.join(root, 'proj');
  mkdirs(P);
  const proj = project(P);
  assert.equal(selectEntry([user, proj], P, deps), user);
  assert.equal(selectEntry([proj, user], P, deps), proj);
});

test('AC2.1: a record for a deleted worktree of P still matches a session at P through the main checkout', () => {
  const root = tmpRoot();
  const P = path.join(root, 'proj');
  gitCheckout(P);
  const A = project(path.join(P, '.claude', 'worktrees', 'w'));
  const C = project(P);
  assert.equal(selectEntry([A, user, C], P, deps), A);
});

test('AC3.1: a session in a linked worktree W of P selects a project(P) record listed before the user record', () => {
  const root = tmpRoot();
  const P = path.join(root, 'proj');
  const W = path.join(root, 'wt');
  gitCheckout(P);
  linkedWorktree(P, W);
  const rec = project(P);
  assert.equal(selectEntry([rec, user], W, deps), rec);
  assert.equal(selectEntry([user, rec], W, deps), user);
});

test('AC4.1/AC4.2: a non-git folder F record applies at exactly F, not at F/sub', (t) => {
  const root = tmpRoot();
  const F = path.join(root, 'plain');
  mkdirs(path.join(F, 'sub'));
  if (canonicalGitRoot(F, deps) !== null) return t.skip('tmpdir sits inside a git checkout');
  const rec = project(F);
  assert.equal(selectEntry([rec], F, deps), rec);
  assert.equal(selectEntry([rec], path.join(F, 'sub'), deps), null);
});

test('AC5.1/AC5.2: a managed record applies anywhere; a local record applies at its own path', (t) => {
  const root = tmpRoot();
  const P = path.join(root, 'proj');
  const other = path.join(root, 'other');
  mkdirs(P, other);
  if (canonicalGitRoot(root, deps) !== null) return t.skip('tmpdir sits inside a git checkout');
  assert.equal(selectEntry([managed], other, deps), managed);
  const loc = local(P);
  assert.equal(selectEntry([loc], P, deps), loc);
  assert.equal(selectEntry([loc], other, deps), null);
});

test('AC6.1: canonicalGitRoot returns null when no ancestor holds a .git', (t) => {
  const root = tmpRoot();
  mkdirs(path.join(root, 'a', 'b'));
  if (canonicalGitRoot(root, deps) !== null) return t.skip('tmpdir sits inside a git checkout');
  assert.equal(canonicalGitRoot(path.join(root, 'a', 'b'), deps), null);
  assert.equal(canonicalGitRoot(path.join(root, 'missing', 'deeper'), deps), null);
});

test('canonicalGitRoot: a .git directory returns that directory, from a subfolder and through missing components', () => {
  const root = tmpRoot();
  const P = path.join(root, 'proj');
  mkdirs(path.join(P, 'sub'));
  gitCheckout(P);
  assert.equal(canonicalGitRoot(P, deps), P);
  assert.equal(canonicalGitRoot(path.join(P, 'sub'), deps), P);
  assert.equal(canonicalGitRoot(path.join(P, 'not', 'there'), deps), P);
});

test('canonicalGitRoot: a relative gitdir: resolves against the .git file directory', () => {
  const root = tmpRoot();
  const P = path.join(root, 'proj');
  const W = path.join(root, 'wt');
  gitCheckout(P);
  const gitdir = path.join(P, '.git', 'worktrees', 'w');
  mkdirs(gitdir, W);
  fs.writeFileSync(path.join(gitdir, 'commondir'), '../..\n');
  fs.writeFileSync(path.join(W, '.git'), `gitdir: ${path.relative(W, gitdir)}\n`);
  assert.equal(canonicalGitRoot(W, deps), P);
});

test('canonicalGitRoot: a commondir with a trailing newline resolves to the main checkout', () => {
  const root = tmpRoot();
  const P = path.join(root, 'proj');
  const W = path.join(root, 'wt');
  gitCheckout(P);
  linkedWorktree(P, W);
  assert.equal(canonicalGitRoot(W, deps), P);
});

test('canonicalGitRoot: a .git file with no commondir returns that directory', () => {
  const root = tmpRoot();
  const W = path.join(root, 'wt');
  const gitdir = path.join(root, 'elsewhere');
  mkdirs(W, gitdir);
  fs.writeFileSync(path.join(W, '.git'), `gitdir: ${gitdir}\n`);
  assert.equal(canonicalGitRoot(W, deps), W);
});

test('canonicalGitRoot: returns null for a non-string path or without deps.readFile', () => {
  assert.equal(canonicalGitRoot(undefined, deps), null);
  assert.equal(canonicalGitRoot(tmpRoot(), { realpath: fs.realpathSync }), null);
});

test('selectEntry: a session at P/sub (git checkout P) matches project(P)', () => {
  const root = tmpRoot();
  const P = path.join(root, 'proj');
  mkdirs(path.join(P, 'sub'));
  gitCheckout(P);
  const rec = project(P);
  assert.equal(selectEntry([user, rec], path.join(P, 'sub'), deps), user);
  assert.equal(selectEntry([rec, user], path.join(P, 'sub'), deps), rec);
});

test('selectEntry: a symlinked session path and a symlinked projectPath both match exactly', (t) => {
  const root = tmpRoot();
  const proj = path.join(root, 'proj');
  mkdirs(proj);
  fs.symlinkSync(proj, path.join(root, 'link'));
  if (canonicalGitRoot(root, deps) !== null) return t.skip('tmpdir sits inside a git checkout');
  const viaReal = project(proj);
  const viaLink = project(path.join(root, 'link'));
  assert.equal(selectEntry([viaReal], path.join(root, 'link'), deps), viaReal);
  assert.equal(selectEntry([viaLink], proj, deps), viaLink);
});

test('selectEntry: no match and no user or managed record returns null', (t) => {
  const root = tmpRoot();
  mkdirs(path.join(root, 'proj'), path.join(root, 'other'));
  if (canonicalGitRoot(root, deps) !== null) return t.skip('tmpdir sits inside a git checkout');
  assert.equal(selectEntry([project(path.join(root, 'proj'))], path.join(root, 'other'), deps), null);
  assert.equal(selectEntry([], path.join(root, 'other'), deps), null);
});

test('selectEntry: non-object entries are skipped', () => {
  const root = tmpRoot();
  mkdirs(path.join(root, 'proj'));
  assert.equal(selectEntry([null, 'x', user], path.join(root, 'proj'), deps), user);
});

test('AC11.1: the installed-plugins.js header names Claude Code 2.1.302, the first-applicable-in-file-order rule, and the 2026-10-19 probe', () => {
  const src = readText(path.join(__dirname, '..', '..', 'plugin', 'bin', 'lib', 'installed-plugins.js'));
  const header = src.slice(0, src.indexOf('require('));
  assert.ok(header.includes('2.1.302'), 'names Claude Code 2.1.302');
  assert.ok(header.includes('2026-10-19'), 'names the probe date');
  assert.ok(header.includes('file order'), 'names the file-order rule');
  assert.ok(!header.includes('excludeHome'), 'no longer mentions excludeHome');
});

function readerDeps(home, env) {
  return { readFile: (p) => fs.readFileSync(p, 'utf8'), homedir: () => home, env };
}

test('readInstalledPlugins: CLAUDE_CONFIG_DIR wins over {home}/.claude', () => {
  const root = tmpRoot();
  const home = path.join(root, 'home');
  const cfg = path.join(root, 'cfg');
  const homeFile = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  const cfgFile = path.join(cfg, 'plugins', 'installed_plugins.json');
  mkdirs(path.dirname(homeFile), path.dirname(cfgFile));
  fs.writeFileSync(homeFile, JSON.stringify({ plugins: { home: true } }));
  fs.writeFileSync(cfgFile, JSON.stringify({ plugins: { cfg: true } }));
  const r = readInstalledPlugins(readerDeps(home, { CLAUDE_CONFIG_DIR: cfg }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { plugins: { cfg: true } });
  assert.equal(r.file, cfgFile);
});

test('readInstalledPlugins: env without CLAUDE_CONFIG_DIR, an empty CLAUDE_CONFIG_DIR, and an absent deps.env all read {home}/.claude', () => {
  const root = tmpRoot();
  const home = path.join(root, 'home');
  const homeFile = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  mkdirs(path.dirname(homeFile));
  fs.writeFileSync(homeFile, JSON.stringify({ plugins: { home: true } }));
  for (const env of [{}, { CLAUDE_CONFIG_DIR: '' }]) {
    const r = readInstalledPlugins(readerDeps(home, env));
    assert.deepEqual(r.data, { plugins: { home: true } }, JSON.stringify(env));
    assert.equal(r.file, homeFile);
  }
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'nonexistent');
  try {
    const r = readInstalledPlugins({ readFile: (p) => fs.readFileSync(p, 'utf8'), homedir: () => home });
    assert.deepEqual(r.data, { plugins: { home: true } });
    assert.equal(r.file, homeFile);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test('readInstalledPlugins: a CLAUDE_CONFIG_DIR with no plugins file does not fall back to home', () => {
  const root = tmpRoot();
  const home = path.join(root, 'home');
  const cfg = path.join(root, 'cfg');
  const homeFile = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  const file = path.join(cfg, 'plugins', 'installed_plugins.json');
  mkdirs(path.dirname(homeFile), cfg);
  fs.writeFileSync(homeFile, JSON.stringify({ plugins: {} }));
  const r = readInstalledPlugins(readerDeps(home, { CLAUDE_CONFIG_DIR: cfg }));
  assert.equal(r.ok, false);
  assert.equal(r.detail, `not found: ${file}`);
  assert.equal(r.file, file);
});

test('readInstalledPlugins: malformed JSON -> malformed JSON (...) detail', () => {
  const root = tmpRoot();
  const home = path.join(root, 'home');
  const file = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  mkdirs(path.dirname(file));
  fs.writeFileSync(file, '{nope');
  const r = readInstalledPlugins(readerDeps(home, {}));
  assert.equal(r.ok, false);
  assert.match(r.detail, /^malformed JSON \(/);
  assert.equal(r.file, file);
});

test('readInstalledPlugins: a non-ENOENT read error passes its message through', () => {
  const r = readInstalledPlugins({
    readFile: () => {
      throw Object.assign(new Error('EACCES: denied'), { code: 'EACCES' });
    },
    homedir: () => '/nowhere',
    env: {},
  });
  assert.equal(r.ok, false);
  assert.equal(r.detail, 'EACCES: denied');
  assert.match(r.file, /installed_plugins\.json$/);
});
