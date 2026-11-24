'use strict';
// #4960: the worktree-reaped event reaches a run the same reconcile pass already closed or archived.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { reapMerged, resolveOwningRunDir, createRunLookupMemo } =require('../../../plugin/bin/lib/reconcile/reap-merged');
const { writeRunState } = require('../../../plugin/bin/lib/hooks/context');
const { closeRunState } = require('../../../plugin/bin/lib/hooks/close-run-state');
const { createPrStateResolver } = require('../../../plugin/bin/lib/reconcile/pr-state-cache');
const { caseInsensitiveFs } = require('../../helpers/case-insensitive-fs');
const { initRepo } = require('../../helpers/git-fixtures');

function git(cwd, ...args) {
  return cp.execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

// Same shape as reap-merged-held.test.js: a main checkout, one harness-domain linked worktree, and
// a run dir whose run-state.json names that worktree.
function buildReapableFixture() {
  const root = fs.realpathSync(scratchDir('reap-merged-owning-'));
  initRepo(root, { branch: 'main', name: 't', email: 't@t' });
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(root, 'add', 'a.txt');
  git(root, 'commit', '-q', '-m', 'init');
  const wtPath = path.join(root, '.claude', 'worktrees', 'issue-1');
  git(root, 'worktree', 'add', '-q', '-b', 'worktree-issue-1', wtPath);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-test-run');
  fs.mkdirSync(runDir, { recursive: true });
  writeRunState(runDir, { worktree: wtPath, status: 'active', sessionId: 'sess-a3' });
  return { root, wtPath, runDir };
}

const merged = (root) => createPrStateResolver({
  root,
  deps: { byBranch: () => ({ number: 4724, state: 'MERGED', mergedAt: '2026-11-01T19:11:16Z', updatedAt: '2026-11-01T19:11:16Z' }) },
});

function closeFixtureRun(runDir, wtPath) {
  const closed = closeRunState(runDir, { explicit: true, checkLiveWorktree: false, callerIdentity: { sessionId: 'sess-a3' } });
  assert.equal(closed.status, 'closed');
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  assert.equal(state.status, 'clean');
  assert.equal(state.worktree, null);
  assert.equal(state.worktreeAtClose, wtPath);
}

function reapEvents(dir) {
  return fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('AC3.1: a merged run already closed and archived by the same pass still gets the worktree-reaped event', () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  closeFixtureRun(runDir, wtPath);
  const archiveBase = path.join(root, '.claude-tweaks', 'pipelines', 'archive');
  fs.mkdirSync(archiveBase, { recursive: true });
  const archived = path.join(archiveBase, path.basename(runDir));
  fs.renameSync(runDir, archived);
  const result = reapMerged({ cwd: root, prStates: merged(root) });
  assert.equal(result.reaped.length, 1, JSON.stringify(result));
  const hit = reapEvents(archived).filter((e) => e.type === 'worktree-reaped');
  assert.equal(hit.length, 1, JSON.stringify(hit));
  assert.equal(hit[0].prNumber, 4724);
});

test('AC3.1: a closed run that is not yet archived gets the event', () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  closeFixtureRun(runDir, wtPath);
  const result = reapMerged({ cwd: root, prStates: merged(root) });
  assert.equal(result.reaped.length, 1, JSON.stringify(result));
  const hit = reapEvents(runDir).filter((e) => e.type === 'worktree-reaped');
  assert.equal(hit.length, 1, JSON.stringify(hit));
  assert.equal(hit[0].prNumber, 4724);
});

test('AC3.1: resolveOwningRunDir: a live run outranks an older archived run that recorded the same path', () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  const old = path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2025-01-01T000000-old');
  fs.mkdirSync(old, { recursive: true });
  writeRunState(old, { status: 'clean', worktree: null, worktreeAtClose: wtPath });
  assert.equal(resolveOwningRunDir(root, wtPath, { includeClosed: true }), runDir);
});

test('resolveOwningRunDir: the newest run id wins across the clean and archived tiers, and the newest archived run wins within its tier', () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  const pipelines = path.join(root, '.claude-tweaks', 'pipelines');
  const archivedOld = path.join(pipelines, 'archive', '2025-01-01T000000-old');
  const archivedMid = path.join(pipelines, 'archive', '2025-06-01T000000-newer');
  for (const d of [archivedOld, archivedMid]) {
    fs.mkdirSync(d, { recursive: true });
    writeRunState(d, { status: 'clean', worktree: null, worktreeAtClose: wtPath });
  }
  const closed = { includeClosed: true };
  assert.equal(resolveOwningRunDir(root, wtPath, closed), runDir, 'live first');
  closeFixtureRun(runDir, wtPath);
  assert.equal(resolveOwningRunDir(root, wtPath, closed), runDir, 'a newer clean run beats older archived runs');
  const archivedNewest = path.join(pipelines, 'archive', '2026-06-01T000000-attempt-2');
  fs.mkdirSync(archivedNewest, { recursive: true });
  writeRunState(archivedNewest, { status: 'clean', worktree: null, worktreeAtClose: wtPath });
  assert.equal(resolveOwningRunDir(root, wtPath, closed), archivedNewest, 'an older clean run loses to a newer archived one');
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.rmSync(archivedNewest, { recursive: true, force: true });
  assert.equal(resolveOwningRunDir(root, wtPath, closed), archivedMid, 'newest archived wins within the tier');
});

test('resolveOwningRunDir: without includeClosed only a live run is found', () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  assert.equal(resolveOwningRunDir(root, wtPath), runDir);
  closeFixtureRun(runDir, wtPath);
  assert.equal(resolveOwningRunDir(root, wtPath), null);
  assert.equal(resolveOwningRunDir(root, wtPath, { includeClosed: true }), runDir);
});

test('reapMerged: a decision skip (pr-open) on a worktree whose only run is closed writes no event into that run', () => {
  const { root, runDir, wtPath } = buildReapableFixture();
  closeFixtureRun(runDir, wtPath);
  const open = createPrStateResolver({ root, deps: { byBranch: () => ({ number: 4725, state: 'OPEN' }) } });
  const result = reapMerged({ cwd: root, prStates: open });
  assert.deepEqual(result.skipped.map((s) => s.reason), ['pr-open']);
  const events = reapEvents(runDir); // closeRunState itself wrote close-without-wrapup
  assert.deepEqual(events.filter((e) => e.type === 'worktree-reap-skipped'), [], JSON.stringify(events));
});

test('resolveOwningRunDir: skips ad-hoc clean and archived dirs, unreadable state, a missing archive dir, and other paths', () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  const pipelines = path.join(root, '.claude-tweaks', 'pipelines');
  fs.rmSync(runDir, { recursive: true, force: true });
  const closed = { includeClosed: true };
  assert.equal(resolveOwningRunDir(root, wtPath, closed), null, 'no archive dir, nothing recorded');
  const adhocClean = path.join(pipelines, '2026-02-01T000000-x-adhoc-standalone');
  fs.mkdirSync(adhocClean, { recursive: true });
  writeRunState(adhocClean, { status: 'clean', worktree: null, worktreeAtClose: wtPath });
  const adhocArchived = path.join(pipelines, 'archive', '2026-03-01T000000-y-adhoc-standalone');
  fs.mkdirSync(adhocArchived, { recursive: true });
  writeRunState(adhocArchived, { status: 'clean', worktree: null, worktreeAtClose: wtPath });
  const broken = path.join(pipelines, 'archive', '2026-04-01T000000-broken');
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, 'run-state.json'), '{not json');
  const other = path.join(pipelines, 'archive', '2026-05-01T000000-other');
  fs.mkdirSync(other, { recursive: true });
  writeRunState(other, { status: 'clean', worktree: null, worktreeAtClose: path.join(root, '.claude', 'worktrees', 'elsewhere') });
  assert.equal(resolveOwningRunDir(root, wtPath, closed), null);
  // A valid, older, non-ad-hoc archived run behind the broken one is still found.
  const valid = path.join(pipelines, 'archive', '2025-01-01T000000-valid');
  fs.mkdirSync(valid, { recursive: true });
  writeRunState(valid, { status: 'clean', worktree: null, worktreeAtClose: wtPath });
  assert.equal(resolveOwningRunDir(root, wtPath, closed), valid);
});

// The injected fake models a case-insensitive volume, as teardown-gate.test.js's #3769 tests do: the
// recorded and target spellings exist only in the fake, so only a path-guard-canonical compare joins them.
const POSIX_ONLY = process.platform === 'win32' && 'posix-only case-insensitive fake: path.resolve/join rewrite its literal paths on win32';

test('resolveOwningRunDir: a recorded path differing only in letter case matches in the clean and archived tiers (#3769 canonicalizer)', { skip: POSIX_ONLY }, () => {
  const { root, runDir } = buildReapableFixture();
  const canonicalPath = '/virtual-volume/Worktrees/Issue-1';
  const fsImpl = caseInsensitiveFs({ '/virtual-volume': 'dir', '/virtual-volume/Worktrees': 'dir', [canonicalPath]: 'dir' });
  const misCased = '/virtual-volume/worktrees/issue-1';
  const opts = { includeClosed: true, fsImpl };
  fs.rmSync(runDir, { recursive: true, force: true });
  const pipelines = path.join(root, '.claude-tweaks', 'pipelines');
  const archived = path.join(pipelines, 'archive', '2025-01-01T000000-case');
  fs.mkdirSync(archived, { recursive: true });
  writeRunState(archived, { status: 'clean', worktree: null, worktreeAtClose: misCased });
  assert.equal(resolveOwningRunDir(root, canonicalPath, opts), archived, 'archived tier');
  const clean = path.join(pipelines, '2026-01-01T000000-case-clean');
  fs.mkdirSync(clean, { recursive: true });
  writeRunState(clean, { status: 'clean', worktree: null, worktreeAtClose: misCased });
  assert.equal(resolveOwningRunDir(root, canonicalPath, opts), clean, 'clean tier');
  assert.equal(resolveOwningRunDir(root, '/virtual-volume/Worktrees/Other', opts), null, 'a different path still misses');
});

test('resolveOwningRunDir: a clean match stops the archive walk at the first archived run that sorts at or below it', (t) => {
  const { root, wtPath, runDir } = buildReapableFixture();
  closeFixtureRun(runDir, wtPath);
  const archiveBase = path.join(root, '.claude-tweaks', 'pipelines', 'archive');
  for (const name of ['2025-01-01T000000-old-a', '2025-06-01T000000-old-b']) {
    fs.mkdirSync(path.join(archiveBase, name), { recursive: true });
    writeRunState(path.join(archiveBase, name), { status: 'clean', worktree: null, worktreeAtClose: wtPath });
  }
  const read = [];
  const realRead = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (...args) => { read.push(String(args[0])); return realRead.apply(fs, args); });
  assert.equal(resolveOwningRunDir(root, wtPath, { includeClosed: true }), runDir);
  // (The clean tier's own archive-twin probe of the newest run's name is not a walk read.)
  const archivedReads = read.filter((p) => p.startsWith(path.join(archiveBase, '2025-')));
  assert.deepEqual(archivedReads, [], 'nothing under an older archived name can win, so none is read');
});

test('resolveOwningRunDir: two lookups sharing one memo read each archived run-state at most once, and agree with unshared lookups', (t) => {
  const { root, wtPath, runDir } = buildReapableFixture();
  fs.rmSync(runDir, { recursive: true, force: true });
  const archiveBase = path.join(root, '.claude-tweaks', 'pipelines', 'archive');
  const names = ['2025-01-01T000000-a', '2025-06-01T000000-b', '2026-01-01T000000-c'];
  for (const name of names) {
    fs.mkdirSync(path.join(archiveBase, name), { recursive: true });
    writeRunState(path.join(archiveBase, name), { status: 'clean', worktree: null, worktreeAtClose: path.join(root, '.claude', 'worktrees', 'elsewhere') });
  }
  const second = path.join(root, '.claude', 'worktrees', 'issue-2');
  writeRunState(path.join(archiveBase, names[0]), { status: 'clean', worktree: null, worktreeAtClose: second });
  const read = [];
  const realRead = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (...args) => { read.push(String(args[0])); return realRead.apply(fs, args); });
  const memo = createRunLookupMemo();
  const opts = { includeClosed: true, memo };
  assert.equal(resolveOwningRunDir(root, wtPath, opts), null, 'no archived run records the first path');
  assert.equal(resolveOwningRunDir(root, second, opts), path.join(archiveBase, names[0]), 'the second path joins the oldest run');
  assert.equal(resolveOwningRunDir(root, wtPath, opts), null, 'a repeat lookup is served from the memo');
  for (const name of names) {
    const file = path.join(archiveBase, name, 'run-state.json');
    assert.equal(read.filter((p) => p === file).length, 1, `${name} read once`);
  }
});

test('resolveOwningRunDir: a recorded path spelled through a symlink matches the canonical worktree path', (t) => {
  const { root, wtPath } = buildReapableFixture();
  const link = path.join(root, 'link-to-worktrees');
  try { fs.symlinkSync(path.join(root, '.claude', 'worktrees'), link, 'dir'); } catch { t.skip('symlinks unavailable'); return; }
  const archived = path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2025-01-01T000000-sym');
  fs.rmSync(path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-test-run'), { recursive: true, force: true });
  fs.mkdirSync(archived, { recursive: true });
  writeRunState(archived, { status: 'clean', worktree: null, worktreeAtClose: path.join(link, 'issue-1') });
  assert.equal(resolveOwningRunDir(root, wtPath, { includeClosed: true }), archived);
});
