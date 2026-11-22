'use strict';
// #4960: reapMerged honours a live session's worktree hold (written by another process).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { reapMerged } = require('../../../plugin/bin/lib/reconcile/reap-merged');
const { writeRunState, ownerBlock } = require('../../../plugin/bin/lib/hooks/context');
const { holdKey, writeHold, holdDirOf } = require('../../../plugin/bin/lib/hooks/worktree-hold');
const { createPrStateResolver } = require('../../../plugin/bin/lib/reconcile/pr-state-cache');
const { initRepo } = require('../../helpers/git-fixtures');

function git(cwd, ...args) {
  return cp.execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

// Same shape as reap-merged.test.js's buildReapableFixture (not exported): a main checkout, one
// harness-domain linked worktree, and a run dir whose run-state.json names that worktree.
function buildReapableFixture() {
  const root = fs.realpathSync(scratchDir('reap-merged-held-'));
  initRepo(root, { branch: 'main', name: 't', email: 't@t' });
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(root, 'add', 'a.txt');
  git(root, 'commit', '-q', '-m', 'init');
  const wtPath = path.join(root, '.claude', 'worktrees', 'issue-1');
  git(root, 'worktree', 'add', '-q', '-b', 'worktree-issue-1', wtPath);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-test-run');
  fs.mkdirSync(runDir, { recursive: true });
  writeRunState(runDir, { worktree: wtPath, status: 'active' });
  return { root, wtPath, runDir };
}

const merged = (root) => createPrStateResolver({
  root,
  deps: { byBranch: () => ({ number: 4724, state: 'MERGED', mergedAt: '2026-11-01T19:11:16Z', updatedAt: '2026-11-01T19:11:16Z' }) },
});

test('AC2.1: reapMerged skips a worktree held by a live session running in another process, and reaps it once that process exits', async () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  const holder = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore', windowsHide: true });
  try {
    const key = holdKey({ sessionId: 'sess-4960', pid: holder.pid });
    assert.ok(writeHold(wtPath, { key, block: ownerBlock({ sessionId: 'sess-4960', env: { CLAUDE_PID: String(holder.pid) } }) }));
    const held = reapMerged({ cwd: root, prStates: merged(root) });
    assert.deepEqual(held.skipped.map((s) => s.reason), ['held']);
    assert.equal(held.reaped.length, 0);
    assert.equal(fs.statSync(wtPath).isDirectory(), true);
    assert.throws(() => fs.statSync(path.join(runDir, 'events.jsonl')), /ENOENT/, 'a held skip is quiet');
  } finally {
    holder.kill();
  }
  if (holder.exitCode === null && holder.signalCode === null) await new Promise((r) => holder.once('exit', r));
  const after = reapMerged({ cwd: root, prStates: merged(root) });
  assert.equal(after.reaped.length, 1, `a dead holder frees the worktree: ${JSON.stringify(after)}`);
});

test('reapMerged: an unverifiable hold keeps the worktree and logs worktree-reap-skipped held-unverifiable', () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  const dir = holdDirOf(wtPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'garbage__main__1.json'), '{not json');
  const result = reapMerged({ cwd: root, prStates: merged(root) });
  assert.deepEqual(result.skipped.map((s) => s.reason), ['held-unverifiable']);
  assert.equal(result.reaped.length, 0);
  assert.equal(fs.statSync(wtPath).isDirectory(), true);
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.type === 'worktree-reap-skipped' && e.reason === 'held-unverifiable'), JSON.stringify(events));
});

test('reapMerged: a dry run reports an unverifiable hold without appending an event', () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  const dir = holdDirOf(wtPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'garbage__main__1.json'), '{not json');
  const result = reapMerged({ cwd: root, dryRun: true, prStates: merged(root) });
  assert.deepEqual(result.skipped.map((s) => s.reason), ['held-unverifiable']);
  assert.throws(() => fs.statSync(path.join(runDir, 'events.jsonl')), /ENOENT/);
});
