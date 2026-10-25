'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { archiveMerged, ORPHAN_MINT_TTL_MS } = require('../../../plugin/bin/lib/reconcile/archive-merged');
const { repoPinnedEnv } = require('../../../plugin/bin/lib/hooks/git-exec');

// #4178: archiveMerged addresses the main checkout via `git -C <root>`, but an
// inherited GIT_DIR (e.g. a process spawned from inside a linked worktree) overrides
// `-C` discovery and would land the archival commit on the worktree's branch. These
// tests pin that the archival commit lands on main and the linked branch HEAD stays put.

// The fixture's own git calls pin the env too: a suite launched under a hook that
// exports GIT_DIR must not redirect the fixture the way it would redirect the code under test.
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: repoPinnedEnv() });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-linked-wt-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'init');
  return dir;
}

function commitPath(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(root, 'add', relPath);
  git(root, 'commit', '-m', `add ${relPath}`);
}

function setup() {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-01-01T000000-record-4178';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/4178-spec.md`, '# 4178\n');
  const wtParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'archive-linked-wt-dir-')));
  const wt = path.join(wtParent, 'wt');
  git(root, 'worktree', 'add', '-b', 'feat', wt);
  // Backdate after the worktree exists so archiveMerged's orphaned-mint branch
  // routes this run dir to archiveRunDir (tracked content, #2227).
  const old = new Date(Date.now() - ORPHAN_MINT_TTL_MS * 2);
  fs.utimesSync(runDir, old, old);
  const mainBefore = git(root, 'rev-parse', 'main');
  const featBefore = git(wt, 'rev-parse', 'HEAD');
  const cleanup = () => {
    fs.rmSync(wtParent, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  };
  return { root, runId, runDir, wt, mainBefore, featBefore, cleanup };
}

function assertLandsOnMain({ root, wt, runDir, runId, mainBefore, featBefore, result }) {
  assert.strictEqual(git(wt, 'rev-parse', 'HEAD').trim(), featBefore.trim(), 'AC1.1: the linked worktree branch HEAD must not move');
  assert.ok(result.archived.includes(runDir), `AC2.2: never silently dropped — got ${JSON.stringify(result)}`);
  assert.notStrictEqual(git(root, 'rev-parse', 'main').trim(), mainBefore.trim(), 'AC2.1: the archival commit lands on main');
  assert.match(git(root, 'log', '-1', '--format=%s', 'main'), /^\[reconcile\] archive run 2026-01-01T000000-record-4178/);
  assert.ok(git(root, 'ls-files').split('\n').includes(`.claude-tweaks/pipelines/archive/${runId}/work/4178-spec.md`));
}

test('AC1.1/AC2.1/AC2.2: archiveMerged from a linked-worktree cwd commits the archival to main, never the worktree branch', (t) => {
  const ctx = setup();
  t.after(ctx.cleanup);
  const result = archiveMerged({ cwd: ctx.wt });
  assertLandsOnMain({ ...ctx, result });
});

test('AC3.1: an inherited GIT_DIR naming the linked worktree does not redirect the archival commit onto its branch', (t) => {
  const ctx = setup();
  t.after(ctx.cleanup);
  const admin = git(ctx.wt, 'rev-parse', '--absolute-git-dir').trim();
  const prior = process.env.GIT_DIR;
  let result;
  process.env.GIT_DIR = admin;
  try {
    result = archiveMerged({ cwd: ctx.wt });
  } finally {
    if (prior === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = prior;
  }
  assertLandsOnMain({ ...ctx, result });
});
