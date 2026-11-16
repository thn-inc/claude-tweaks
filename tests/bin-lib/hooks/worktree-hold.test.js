'use strict';
// worktree-hold.js (#4960): per-worktree session presence files kept in the
// worktree's own git admin dir. Every function is best-effort and never throws.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  HOLD_DIR_NAME, holdKey, worktreeRootOf, holdDirOf, writeHold, readHolds, clearHolds, clearSessionHolds,
} = require('../../../plugin/bin/lib/hooks/worktree-hold');
const { safeReal } = require('../../../plugin/bin/lib/hooks/worktree-detect');
const { gitRepo, harnessWorktreeOf } = require('../../helpers/git-fixtures');

const BLOCK = { sessionId: 's1', host: 'h', pid: 42, pidSource: 'env', pidStartedAt: 'T', heartbeatAt: 'Z' };

test('holdKey: joins session, agent (default main) and pid; rejects path-hostile parts', () => {
  assert.strictEqual(HOLD_DIR_NAME, 'claude-tweaks-holds');
  assert.strictEqual(holdKey({ sessionId: 's1', pid: 42 }), 's1__main__42');
  assert.strictEqual(holdKey({ sessionId: 's1', agentId: 'a9', pid: 42 }), 's1__a9__42');
  assert.strictEqual(holdKey({ sessionId: 's1', agentId: '', pid: 42 }), 's1__main__42');
  assert.strictEqual(holdKey({ sessionId: '../x', pid: 42 }), null);
  assert.strictEqual(holdKey({ sessionId: 's1', agentId: 'a/b', pid: 42 }), null);
  assert.strictEqual(holdKey({ sessionId: 's1', pid: 0 }), null);
  assert.strictEqual(holdKey({ sessionId: 's1', pid: '42' }), null);
  assert.strictEqual(holdKey({ pid: 42 }), null);
  assert.strictEqual(holdKey(), null);
});

test('worktreeRootOf: a subdirectory of a linked worktree resolves to the worktree; the main checkout resolves to null', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'wt-root');
  fs.mkdirSync(path.join(wt, 'a', 'b'), { recursive: true });
  assert.strictEqual(worktreeRootOf(path.join(wt, 'a', 'b')), wt);
  assert.strictEqual(worktreeRootOf(main), null);
});

test("holdDirOf: names the worktree's own admin dir; null for the main checkout", () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'wt-admin');
  const admin = fs.realpathSync(path.join(main, '.git', 'worktrees', path.basename(wt)));
  assert.strictEqual(safeReal(path.dirname(holdDirOf(wt))), safeReal(admin));
  assert.strictEqual(path.basename(holdDirOf(wt)), 'claude-tweaks-holds');
  assert.strictEqual(holdDirOf(main), null);
});

test('writeHold + readHolds: round-trips the owner block with agentId and worktree', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'wt-rt');
  const key = 's1__main__42';
  assert.strictEqual(writeHold(wt, { key, block: BLOCK }), true);
  assert.deepStrictEqual(readHolds(wt), [{ key, hold: { ...BLOCK, agentId: null, worktree: wt, key } }]);
  assert.deepStrictEqual(fs.readdirSync(holdDirOf(wt)).filter((f) => f.includes('.tmp-')), []);
});

test('writeHold: refuses the main checkout and writes nothing', () => {
  const main = gitRepo();
  assert.strictEqual(writeHold(main, { key: 's1__main__42', block: BLOCK }), false);
  assert.ok(!fs.readdirSync(path.join(main, '.git')).includes('claude-tweaks-holds'));
});

test('readHolds: an unparseable hold reads as { hold: null }', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'wt-bad');
  const dir = holdDirOf(wt);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'x.json'), '{not json');
  assert.deepStrictEqual(readHolds(wt), [{ key: 'x', hold: null }]);
});

test('clearHolds: removes the key from other worktrees, keeps the except worktree and other keys', () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wt-a');
  const b = harnessWorktreeOf(main, 'wt-b');
  for (const [wt, key] of [[a, 'k'], [b, 'k'], [a, 'other']]) assert.ok(writeHold(wt, { key, block: BLOCK }));
  assert.strictEqual(clearHolds(main, { key: 'k', except: b }), 1);
  assert.deepStrictEqual(readHolds(a).map((h) => h.key), ['other']);
  assert.deepStrictEqual(readHolds(b).map((h) => h.key), ['k']);
});

test('clearHolds: a missing .git directory removes nothing', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'wt-nogit');
  assert.strictEqual(clearHolds(wt, { key: 'k' }), 0);
});

test('clearSessionHolds: removes this session+pid only', () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wt-s');
  for (const key of ['s1__main__42', 's1__a9__42', 's1__main__43', 's2__main__42']) assert.ok(writeHold(a, { key, block: BLOCK }));
  assert.strictEqual(clearSessionHolds(main, { sessionId: 's1', pid: 42 }), 2);
  assert.deepStrictEqual(readHolds(a).map((h) => h.key).sort(), ['s1__main__43', 's2__main__42']);
});
