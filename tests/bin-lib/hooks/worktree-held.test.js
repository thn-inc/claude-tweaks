'use strict';
// #4960: holdVerdict / isHeldByLiveSession — the liveness predicate over a worktree's holds,
// and reapWorktrees honouring it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  holdVerdict, isHeldByLiveSession, reapWorktrees, REASON, QUIET_SKIP_REASONS, MAX_EXAMINED_PER_RUN,
} = require('../../../plugin/bin/lib/hooks/worktree-reap');
const { holdKey, writeHold, holdDirOf } = require('../../../plugin/bin/lib/hooks/worktree-hold');
const { gitRepo, harnessWorktreeOf } = require('../../helpers/git-fixtures');

function worktree() {
  const main = gitRepo();
  return { main, wt: harnessWorktreeOf(main) };
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

test('isHeldByLiveSession: no hold directory -> false', () => {
  const { wt } = worktree();
  assert.equal(holdVerdict(wt), 'free');
  assert.equal(isHeldByLiveSession(wt), false);
});

test('isHeldByLiveSession: a hold naming this live process -> true', () => {
  const { wt } = worktree();
  hold(wt);
  assert.equal(holdVerdict(wt), 'held');
  assert.equal(isHeldByLiveSession(wt), true);
});

test('isHeldByLiveSession: a hold whose pid is dead -> false', () => {
  const { wt } = worktree();
  hold(wt);
  assert.equal(holdVerdict(wt, { isAlive: () => false }), 'free');
  assert.equal(isHeldByLiveSession(wt, { isAlive: () => false }), false);
});

test("holdVerdict: an unparseable hold -> 'unverifiable', and isHeldByLiveSession -> true (fails closed)", () => {
  const { wt } = worktree();
  garbageHold(wt);
  assert.equal(holdVerdict(wt), 'unverifiable');
  assert.equal(isHeldByLiveSession(wt), true);
});

test("holdVerdict: a hold from another host -> 'unverifiable'", () => {
  const { wt } = worktree();
  hold(wt, { host: 'elsewhere' });
  assert.equal(holdVerdict(wt), 'unverifiable');
  assert.equal(isHeldByLiveSession(wt), true);
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
  assert.equal(isHeldByLiveSession(wt), true);
});

test("holdVerdict: a dead hold beside an unparseable one -> 'unverifiable' (the dead one does not mask it)", () => {
  const { wt } = worktree();
  hold(wt);
  garbageHold(wt);
  const opts = { isAlive: (pid) => pid !== process.pid };
  assert.equal(holdVerdict(wt, opts), 'unverifiable');
});

test('isHeldByLiveSession: a recycled pid (start time differs) -> false; an unknown start time never frees it', () => {
  const { wt } = worktree();
  hold(wt, { pidStartedAt: 'A' });
  assert.equal(holdVerdict(wt, { startTime: () => 'B' }), 'free');
  assert.equal(isHeldByLiveSession(wt, { startTime: () => 'B' }), false);
  assert.equal(holdVerdict(wt, { startTime: () => 'A' }), 'held');
  assert.equal(holdVerdict(wt, { startTime: () => null }), 'held');
  assert.equal(isHeldByLiveSession(wt, { startTime: () => null }), true);
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
  assert.equal(isHeldByLiveSession(wt, { isAlive: boom }), true);
  assert.equal(holdVerdict(wt, { hostname: boom }), 'unverifiable');
});

test('holdVerdict: a path that is not a worktree at all -> free', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'held-nowt-')));
  assert.equal(holdVerdict(dir), 'free');
});

test('reapWorktrees: skips a held worktree with REASON.HELD even when merged and clean', () => {
  const { main, wt } = worktree();
  const base = require('child_process').execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: main, encoding: 'utf8' }).trim();
  hold(wt);
  const res = reapWorktrees({ cwd: main, integration: base });
  assert.deepEqual(res.reaped, []);
  assert.deepEqual(res.skipped, [{ path: wt, reason: REASON.HELD }]);
  assert.equal(fs.statSync(wt).isDirectory(), true);
  assert.equal(QUIET_SKIP_REASONS.has(REASON.HELD), true);
});

test('reapWorktrees: a held worktree does not spend the examined cap', () => {
  const main = gitRepo();
  const base = require('child_process').execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: main, encoding: 'utf8' }).trim();
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
  const base = require('child_process').execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: main, encoding: 'utf8' }).trim();
  garbageHold(wt);
  const res = reapWorktrees({ cwd: main, integration: base });
  assert.deepEqual(res.skipped, [{ path: wt, reason: REASON.HELD_UNVERIFIABLE }]);
  assert.equal(fs.statSync(wt).isDirectory(), true);
  assert.equal(QUIET_SKIP_REASONS.has(REASON.HELD_UNVERIFIABLE), false);
});
