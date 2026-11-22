'use strict';
// worktree-hold.js (#4960): per-worktree session presence files kept in the
// worktree's own git admin dir. Every function is best-effort and never throws.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chmodDenialSkip } = require('../../helpers/root');
const {
  HOLD_DIR_NAME, holdKey, worktreeRootOf, holdDirOf, writeHold, readHolds, clearHolds, clearSessionHolds,
  stampHoldForCwd, releaseSessionHolds, releaseAgentHolds,
} = require('../../../plugin/bin/lib/hooks/worktree-hold');
const { ownerBlock } = require('../../../plugin/bin/lib/hooks/context');
const processProbe = require('../../../plugin/bin/lib/run-liveness/process-probe');
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

test('clearHolds: a linked worktree passed as mainRoot (its .git is a file) removes nothing', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'wt-nogit');
  const other = harnessWorktreeOf(main, 'wt-nogit-2');
  assert.ok(writeHold(wt, { key: 'k', block: BLOCK }));
  assert.ok(writeHold(other, { key: 'k', block: BLOCK }));
  assert.strictEqual(clearHolds(wt, { key: 'k' }), 0);
  assert.deepStrictEqual(readHolds(wt).map((h) => h.key), ['k']);
  assert.deepStrictEqual(readHolds(other).map((h) => h.key), ['k']);
});

test('holdKey: a part cannot contain the `__` separator', () => {
  assert.strictEqual(holdKey({ sessionId: 'a__b', pid: 42 }), null);
  assert.strictEqual(holdKey({ sessionId: 's1', agentId: 'a__b', pid: 42 }), null);
  assert.strictEqual(holdKey({ sessionId: '_a', pid: 42 }), null);
  assert.strictEqual(holdKey({ sessionId: '0a1b2c3d-4e5f-6789-abcd-ef0123456789', agentId: 'agent_1', pid: 7 }), '0a1b2c3d-4e5f-6789-abcd-ef0123456789__agent_1__7');
});

test('clearSessionHolds: a file of another shape (extra segment) is not matched', () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wt-shape');
  const odd = path.join(holdDirOf(a), 's1__x__main__42.json');
  assert.ok(writeHold(a, { key: 's1__main__42', block: BLOCK }));
  const trailing = path.join(holdDirOf(a), 's1__main__42__extra.json');
  const emptyMiddle = path.join(holdDirOf(a), 's1____42.json');
  const oddMiddle = path.join(holdDirOf(a), 's1___x__42.json');
  for (const f of [odd, trailing, emptyMiddle, oddMiddle]) fs.writeFileSync(f, '{}');
  assert.strictEqual(clearSessionHolds(main, { sessionId: 's1', pid: 42 }), 1);
  for (const f of [odd, trailing, emptyMiddle, oddMiddle]) assert.ok(fs.existsSync(f), f);
});

test('writeHold: rejects keys carrying a path separator or dot-dot', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'wt-keys');
  for (const key of ['a/b', '..', '../x', 'a\\b', '', 'a___b']) assert.strictEqual(writeHold(wt, { key, block: BLOCK }), false, key);
  assert.deepStrictEqual(readHolds(wt), []);
});

test('writeHold: a pruned admin dir is not recreated', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'wt-pruned');
  const admin = path.dirname(holdDirOf(wt));
  fs.rmSync(admin, { recursive: true, force: true });
  assert.strictEqual(writeHold(wt, { key: 's1__main__42', block: BLOCK }), false);
  assert.ok(!fs.existsSync(admin));
});

test('submodule-shaped .git file (gitdir under modules/) is not a worktree', () => {
  const main = gitRepo();
  const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hold-sub-'));
  try {
    fs.mkdirSync(path.join(main, '.git', 'modules', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(sub, '.git'), `gitdir: ${path.join(main, '.git', 'modules', 'sub')}\n`);
    const subReal = fs.realpathSync(sub);
    assert.strictEqual(holdDirOf(subReal), null);
    assert.strictEqual(worktreeRootOf(subReal), null);
    assert.strictEqual(writeHold(subReal, { key: 's1__main__42', block: BLOCK }), false);
    assert.deepStrictEqual(readHolds(subReal), []);
  } finally {
    fs.rmSync(sub, { recursive: true, force: true });
  }
});

test('holdDirOf: a relative gitdir resolves against the worktree', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hold-rel-')));
  try {
    const wt = path.join(root, 'wt');
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ../admin/worktrees/w\n');
    assert.strictEqual(holdDirOf(wt), path.join(root, 'admin', 'worktrees', 'w', 'claude-tweaks-holds'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readHolds: a worktree with no hold dir reads as []', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'wt-nohold');
  assert.deepStrictEqual(readHolds(wt), []);
  assert.deepStrictEqual(readHolds(main), []);
});

test('readHolds: a dir with no .git, and a path that does not exist, read as [] (never held forever)', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hold-nogit-')));
  try {
    assert.deepStrictEqual(readHolds(root), []);
    assert.deepStrictEqual(readHolds(path.join(root, 'gone')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readHolds: a .git file with no gitdir line fails closed; holdDirOf is null', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hold-nolinegit-')));
  try {
    fs.writeFileSync(path.join(root, '.git'), 'not a gitdir line\n');
    assert.strictEqual(holdDirOf(root), null);
    assert.deepStrictEqual(readHolds(root), [{ key: null, hold: null }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readHolds: an unreadable hold dir fails closed as one unverifiable entry', chmodDenialSkip('root ignores mode 000'), () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'wt-denied');
  assert.ok(writeHold(wt, { key: 's1__main__42', block: BLOCK }));
  const dir = holdDirOf(wt);
  fs.chmodSync(dir, 0o000);
  try {
    assert.deepStrictEqual(readHolds(wt), [{ key: null, hold: null }]);
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

test('readHolds: a worktree whose .git cannot even be stat-ed fails closed', chmodDenialSkip('root ignores mode 000'), () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'wt-nosearch');
  fs.chmodSync(wt, 0o000);
  try {
    assert.deepStrictEqual(readHolds(wt), [{ key: null, hold: null }]);
  } finally {
    fs.chmodSync(wt, 0o755);
  }
});

test('readHolds: a .git file that cannot be read fails closed', chmodDenialSkip('root ignores mode 000'), () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'wt-gitdenied');
  const gitFile = path.join(wt, '.git');
  fs.chmodSync(gitFile, 0o000);
  try {
    assert.deepStrictEqual(readHolds(wt), [{ key: null, hold: null }]);
  } finally {
    fs.chmodSync(gitFile, 0o644);
  }
});

test('clearSessionHolds: removes this session+pid only', () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wt-s');
  for (const key of ['s1__main__42', 's1__a9__42', 's1__main__43', 's2__main__42']) assert.ok(writeHold(a, { key, block: BLOCK }));
  assert.strictEqual(clearSessionHolds(main, { sessionId: 's1', pid: 42 }), 2);
  assert.deepStrictEqual(readHolds(a).map((h) => h.key).sort(), ['s1__main__43', 's2__main__42']);
});

test('stampHoldForCwd: a resumed session in a worktree re-stamps with its current pid', () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wt-resume');
  assert.ok(writeHold(a, { key: 's1__home__1', block: BLOCK }));
  fs.mkdirSync(path.join(a, 'sub'));
  const out = stampHoldForCwd({ cwd: path.join(a, 'sub'), sessionId: 's1', env: { CLAUDE_PID: String(process.pid) }, ownerBlock });
  assert.strictEqual(out, 'stamped');
  const holds = readHolds(a);
  assert.ok(holds.some((h) => h.key === `s1__home__${process.pid}`));
  assert.strictEqual(holds.find((h) => h.key === `s1__home__${process.pid}`).hold.agentId, null);
});

test('releaseSessionHolds clears the home hold too', () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wt-home-rel');
  assert.strictEqual(stampHoldForCwd({ cwd: a, sessionId: 's1', env: { CLAUDE_PID: '42' }, ownerBlock }), 'stamped');
  assert.deepStrictEqual(readHolds(a).map((h) => h.key), ['s1__home__42']);
  assert.strictEqual(releaseSessionHolds({ cwd: a, sessionId: 's1', env: { CLAUDE_PID: '42' } }), 1);
  assert.deepStrictEqual(readHolds(a), []);
});

test('releaseAgentHolds: the default pid source is process-probe\'s resolveOwnerPid', () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wt-agent-default');
  assert.ok(writeHold(a, { key: 's1__ag1__88', block: BLOCK, agentId: 'ag1' }));
  const real = processProbe.resolveOwnerPid;
  processProbe.resolveOwnerPid = () => ({ pid: 88, pidSource: 'ancestry' });
  try {
    assert.strictEqual(releaseAgentHolds({ cwd: a, sessionId: 's1', agentId: 'ag1', env: {} }), 1);
  } finally {
    processProbe.resolveOwnerPid = real;
  }
  assert.deepStrictEqual(readHolds(a), []);
});

test('releaseSessionHolds: clears only this pid\'s holds (a nested claude -p ending leaves the parent\'s)', () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wt-rel');
  for (const key of ['s1__main__42', `s1__main__${process.pid}`]) assert.ok(writeHold(a, { key, block: BLOCK }));
  assert.strictEqual(releaseSessionHolds({ cwd: a, sessionId: 's1', env: { CLAUDE_PID: '42' } }), 1);
  assert.deepStrictEqual(readHolds(a).map((h) => h.key), [`s1__main__${process.pid}`]);
});

test('releaseSessionHolds: with no CLAUDE_PID, releases the hold written under the ancestry pid', () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wt-anc');
  assert.ok(writeHold(a, { key: 's1__main__77', block: BLOCK }));
  assert.strictEqual(
    releaseSessionHolds({ cwd: a, sessionId: 's1', env: {}, resolvePid: () => ({ pid: 77, pidSource: 'ancestry' }) }),
    1,
  );
  assert.deepStrictEqual(readHolds(a), []);
});

test('releaseSessionHolds: the default pid source is process-probe\'s resolveOwnerPid (the one ownerBlock stamps with)', () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wt-default');
  assert.ok(writeHold(a, { key: 's1__main__88', block: BLOCK }));
  const real = processProbe.resolveOwnerPid;
  processProbe.resolveOwnerPid = () => ({ pid: 88, pidSource: 'ancestry' });
  try {
    assert.strictEqual(releaseSessionHolds({ cwd: a, sessionId: 's1', env: {} }), 1);
  } finally {
    processProbe.resolveOwnerPid = real;
  }
  assert.deepStrictEqual(readHolds(a), []);
});

test('releaseAgentHolds: a finished subagent\'s hold is removed; the main thread\'s stays', () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wt-ma');
  const b = harnessWorktreeOf(main, 'wt-ag');
  assert.ok(writeHold(a, { key: `s1__main__${process.pid}`, block: BLOCK }));
  assert.ok(writeHold(b, { key: `s1__ag1__${process.pid}`, block: BLOCK, agentId: 'ag1' }));
  const env = { CLAUDE_PID: String(process.pid) };
  assert.strictEqual(releaseAgentHolds({ cwd: b, sessionId: 's1', env }), 0);
  assert.strictEqual(readHolds(b).length, 1);
  assert.strictEqual(releaseAgentHolds({ cwd: b, sessionId: 's1', agentId: 'ag1', env }), 1);
  assert.deepStrictEqual(readHolds(b), []);
  assert.deepStrictEqual(readHolds(a).map((h) => h.key), [`s1__main__${process.pid}`]);
});

test("stampHoldForCwd: a failed hold write returns 'failed', apart from 'skipped' for a non-worktree (#4960)", () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wt-failed');
  const holdDir = holdDirOf(a);
  fs.writeFileSync(holdDir, 'not a directory');
  const env = { CLAUDE_PID: String(process.pid) };
  assert.strictEqual(stampHoldForCwd({ cwd: a, sessionId: 's1', env, ownerBlock }), 'failed');
  assert.strictEqual(stampHoldForCwd({ cwd: main, sessionId: 's1', env, ownerBlock }), 'skipped');
  assert.strictEqual(stampHoldForCwd({ cwd: a, sessionId: '../x', env, ownerBlock }), 'skipped');
});

test('readHolds: a hold that vanishes between the listing and the read is released; any other read failure stays unverifiable', (t) => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'wt-vanish');
  assert.ok(writeHold(wt, { key: 'gone__main__1', block: BLOCK }));
  assert.ok(writeHold(wt, { key: 'kept__main__2', block: BLOCK }));
  const real = fs.readFileSync;
  const failing = (code) => t.mock.method(fs, 'readFileSync', (p, ...rest) => {
    if (String(p).endsWith('gone__main__1.json')) throw Object.assign(new Error(code), { code });
    return real.call(fs, p, ...rest);
  });
  let spy = failing('ENOENT');
  assert.deepStrictEqual(readHolds(wt).map((e) => e.key), ['kept__main__2']);
  spy.mock.restore();
  spy = failing('EACCES');
  assert.deepStrictEqual(readHolds(wt).map((e) => [e.key, e.hold === null]), [['gone__main__1', true], ['kept__main__2', false]]);
  spy.mock.restore();
});
