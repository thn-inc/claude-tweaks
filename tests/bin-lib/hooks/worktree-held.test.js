'use strict';
// #4960: holdVerdict — the liveness predicate over a worktree's holds,
// and reapWorktrees honouring it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const {
  holdVerdict, reapWorktrees, REASON, QUIET_SKIP_REASONS, MAX_EXAMINED_PER_RUN,
} = require('../../../plugin/bin/lib/hooks/worktree-reap');
const { holdKey, writeHold, holdDirOf } = require('../../../plugin/bin/lib/hooks/worktree-hold');
const { gitRepo, harnessWorktreeOf } = require('../../helpers/git-fixtures');

function worktree() {
  const main = gitRepo();
  return { main, wt: harnessWorktreeOf(main) };
}

// The repo's initial branch (gitRepo() leaves it to the machine's init.defaultBranch).
function currentBranch(main) {
  return execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: main, encoding: 'utf8', windowsHide: true }).trim();
}

// A real hold file via writeHold, with a hand-shaped block so each field is controllable.
function hold(wt, over = {}, sessionId = 'sess-1') {
  const block = { sessionId, host: os.hostname(), pid: process.pid, pidStartedAt: null, ...over };
  const key = holdKey({ sessionId, pid: Number.isInteger(block.pid) && block.pid > 0 ? block.pid : 1 });
  assert.ok(writeHold(wt, { key, block }), 'fixture hold must be written');
  return key;
}

function garbageHold(wt, name = 'garbage__main__1') {
  const dir = holdDirOf(wt);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), '{not json');
}

test("holdVerdict: no hold directory -> 'free'", () => {
  const { wt } = worktree();
  assert.equal(holdVerdict(wt), 'free');
});

test("holdVerdict: a hold naming this live process -> 'held'", () => {
  const { wt } = worktree();
  hold(wt);
  assert.equal(holdVerdict(wt), 'held');
});

test("holdVerdict: a hold whose pid is dead -> 'free'", () => {
  const { wt } = worktree();
  hold(wt);
  assert.equal(holdVerdict(wt, { isAlive: () => false }), 'free');
});

test("holdVerdict: an unparseable hold -> 'unverifiable' (fails closed)", () => {
  const { wt } = worktree();
  garbageHold(wt);
  assert.equal(holdVerdict(wt), 'unverifiable');
});

test("holdVerdict: a hold from another host -> 'unverifiable'", () => {
  const { wt } = worktree();
  hold(wt, { host: 'elsewhere' });
  assert.equal(holdVerdict(wt), 'unverifiable');
});

test("holdVerdict: a hold with no usable pid -> 'unverifiable'", () => {
  const { wt } = worktree();
  hold(wt, { pid: 'x' });
  assert.equal(holdVerdict(wt), 'unverifiable');
});

test("holdVerdict: a live hold beside an unparseable one -> 'held' (a verified live session wins the quiet reason)", () => {
  const { wt } = worktree();
  hold(wt);
  garbageHold(wt);
  assert.equal(holdVerdict(wt), 'held');
});

test("holdVerdict: a dead hold beside an unparseable one -> 'unverifiable' (the dead one does not mask it)", () => {
  const { wt } = worktree();
  hold(wt);
  garbageHold(wt);
  const opts = { isAlive: (pid) => pid !== process.pid };
  assert.equal(holdVerdict(wt, opts), 'unverifiable');
});

test("holdVerdict: a recycled pid (start time differs) -> 'free'; an unknown start time never frees it", () => {
  const { wt } = worktree();
  hold(wt, { pidStartedAt: 'A' });
  assert.equal(holdVerdict(wt, { startTime: () => 'B' }), 'free');
  assert.equal(holdVerdict(wt, { startTime: () => 'A' }), 'held');
  assert.equal(holdVerdict(wt, { startTime: () => null }), 'held');
  assert.equal(holdVerdict(wt, { startTime: () => '' }), 'held');
});

test('holdVerdict: a hold with no recorded start time is judged by pid liveness alone', () => {
  const { wt } = worktree();
  hold(wt, { pidStartedAt: null });
  assert.equal(holdVerdict(wt, { startTime: () => 'B' }), 'held');
});

test("holdVerdict: never throws — a throwing probe reads 'unverifiable'", () => {
  const { wt } = worktree();
  hold(wt);
  const boom = () => { throw new Error('probe broke'); };
  assert.equal(holdVerdict(wt, { isAlive: boom }), 'unverifiable');
  assert.equal(holdVerdict(wt, { hostname: boom }), 'unverifiable');
});

test('holdVerdict: a probe that throws with a message equal to a dead detail is unverifiable, not free', () => {
  const { wt } = worktree();
  hold(wt);
  for (const message of ['gone', 'pid-reused']) {
    assert.equal(holdVerdict(wt, { isAlive: () => { throw new Error(message); } }), 'unverifiable', message);
  }
});

test('holdVerdict: a path that is not a worktree at all -> free', () => {
  const dir = fs.realpathSync(scratchDir('held-nowt-'));
  assert.equal(holdVerdict(dir), 'free');
});

test('reapWorktrees: skips a held worktree with REASON.HELD even when merged and clean', () => {
  const { main, wt } = worktree();
  const base = currentBranch(main);
  hold(wt);
  const res = reapWorktrees({ cwd: main, integration: base });
  assert.deepEqual(res.reaped, []);
  assert.deepEqual(res.skipped, [{ path: wt, reason: REASON.HELD }]);
  assert.equal(fs.statSync(wt).isDirectory(), true);
  assert.equal(QUIET_SKIP_REASONS.has(REASON.HELD), true);
});

test('reapWorktrees: a held worktree does not spend the examined cap', () => {
  const main = gitRepo();
  const base = currentBranch(main);
  const held = harnessWorktreeOf(main, 'a-held');
  hold(held);
  const free = Array.from({ length: MAX_EXAMINED_PER_RUN }, (_, i) => harnessWorktreeOf(main, `b-free-${i}`));
  const res = reapWorktrees({ cwd: main, integration: base });
  assert.equal(res.deferred, 0, JSON.stringify(res));
  assert.deepEqual([...res.reaped].sort(), [...free].sort());
  assert.deepEqual(res.skipped, [{ path: held, reason: REASON.HELD }]);
});

test('reapWorktrees: only an unparseable hold -> REASON.HELD_UNVERIFIABLE, which is not quiet', () => {
  const { main, wt } = worktree();
  const base = currentBranch(main);
  garbageHold(wt);
  const res = reapWorktrees({ cwd: main, integration: base });
  assert.deepEqual(res.skipped, [{ path: wt, reason: REASON.HELD_UNVERIFIABLE }]);
  assert.equal(fs.statSync(wt).isDirectory(), true);
  assert.equal(QUIET_SKIP_REASONS.has(REASON.HELD_UNVERIFIABLE), false);
});
