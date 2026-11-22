// tests/hooks-post-tool-use-worktree-hold.test.js
//
// #4960: post-tool-use's EnterWorktree / ExitWorktree branches write and clear the
// session's worktree hold (worktree-hold.js). Drives the real post-tool-use run(ctx).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir, isolateTmpdir } = require('./helpers/tmp-dir');
isolateTmpdir('ct-iso-hooks-post-tool-use-work-');
const os = require('os');
const path = require('path');
const post = require('../plugin/bin/lib/hooks/post-tool-use');
const hold = require('../plugin/bin/lib/hooks/worktree-hold');
const { ownerBlock } = require('../plugin/bin/lib/hooks/context');
const { gitRepo, harnessWorktreeOf } = require('./helpers/git-fixtures');

function enterCtx(wt, input = {}) {
  return {
    input: {
      tool_name: 'EnterWorktree',
      cwd: wt,
      session_id: 's1',
      tool_response: createdAt(wt, 'b'),
      ...input,
    },
    cwd: wt,
    env: process.env,
  };
}

function createdAt(wt, branch) {
  return {
    content: `Created worktree at ${wt} on branch ${branch}. The session is now working in the ` +
      'worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.',
  };
}

// CLAUDE_PID pinned to this process for the test's duration.
function withPid(fn) {
  const prev = process.env.CLAUDE_PID;
  process.env.CLAUDE_PID = String(process.pid);
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.CLAUDE_PID; else process.env.CLAUDE_PID = prev;
  }
}

const keys = (wt) => hold.readHolds(wt).map((e) => e.key);

test('EnterWorktree stamps a hold in the entered worktree', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'hold-a');
  post.run(enterCtx(a));
  const holds = hold.readHolds(a);
  assert.strictEqual(holds.length, 1);
  assert.strictEqual(holds[0].hold.sessionId, 's1');
  assert.strictEqual(holds[0].hold.pid, process.pid);
}));

test('entering a second worktree moves the hold', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'hold-a');
  const b = harnessWorktreeOf(main, 'hold-b');
  post.run(enterCtx(a));
  post.run(enterCtx(b));
  assert.deepStrictEqual(hold.readHolds(a), []);
  assert.deepStrictEqual(keys(b), [`s1__main__${process.pid}`]);
}));

test('ExitWorktree clears the session\'s hold', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'hold-a');
  post.run(enterCtx(a));
  assert.strictEqual(hold.readHolds(a).length, 1);
  post.run({ env: process.env, input: { tool_name: 'ExitWorktree', cwd: main, session_id: 's1' }, cwd: main });
  assert.deepStrictEqual(hold.readHolds(a), []);
}));

test('a subagent\'s EnterWorktree (agent_id set) leaves the main thread\'s hold in place', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'hold-a');
  const b = harnessWorktreeOf(main, 'hold-b');
  post.run(enterCtx(a));
  post.run(enterCtx(b, { agent_id: 'ag1' }));
  assert.deepStrictEqual(keys(a), [`s1__main__${process.pid}`]);
  assert.deepStrictEqual(keys(b), [`s1__ag1__${process.pid}`]);
}));

test('a subagent\'s ExitWorktree (agent_id set) clears only its own hold, not the main thread\'s', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'hold-a');
  const b = harnessWorktreeOf(main, 'hold-b');
  post.run(enterCtx(a));
  post.run(enterCtx(b, { agent_id: 'ag1' }));
  assert.deepStrictEqual(keys(b), [`s1__ag1__${process.pid}`]);
  post.run({ env: process.env, input: { tool_name: 'ExitWorktree', cwd: main, session_id: 's1', agent_id: 'ag1' }, cwd: main });
  assert.deepStrictEqual(hold.readHolds(b), []);
  assert.deepStrictEqual(keys(a), [`s1__main__${process.pid}`]);
}));

test('a failed hold write leaves a worktree-hold-failed event in the owned run, and never changes the outcome', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'hold-a');
  const holdDir = hold.holdDirOf(a);
  const runDir = scratchDir('hold-failed-run-');
  const ctx = { ...enterCtx(a), ownedRun: { dir: runDir } };
  const clean = post.run(ctx);
  fs.rmSync(holdDir, { recursive: true });
  fs.writeFileSync(holdDir, 'not a directory');
  const out = post.run(ctx);
  assert.deepStrictEqual(out, clean);
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepStrictEqual(events.filter((e) => e.type === 'worktree-hold-failed').map((e) => e.tool), ['EnterWorktree']);
}));

test('no resolvable Claude pid writes no hold', () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'hold-a');
  const out = hold.syncHoldForToolUse(
    { tool_name: 'EnterWorktree', session_id: 's1' },
    { cwd: a, env: {}, ownerBlock: () => ({ pid: null }), resolveEnteredPath: () => a },
  );
  assert.strictEqual(out, 'skipped');
  assert.deepStrictEqual(hold.readHolds(a), []);
});

test('a hold-write failure never changes post-tool-use\'s outcome', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'hold-a');
  const holdDir = hold.holdDirOf(a);
  const clean = post.run(enterCtx(a));
  assert.strictEqual(hold.readHolds(a).length, 1);
  fs.rmSync(holdDir, { recursive: true });
  fs.writeFileSync(holdDir, 'not a directory');
  const out = post.run(enterCtx(a));
  assert.deepStrictEqual(out, clean);
  assert.ok(fs.statSync(holdDir).isFile());
}));

test('ExitWorktree from inside the worktree being exited clears its hold', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'hold-a');
  post.run(enterCtx(a));
  assert.strictEqual(hold.readHolds(a).length, 1);
  post.run({ env: process.env, input: { tool_name: 'ExitWorktree', cwd: a, session_id: 's1' }, cwd: a });
  assert.deepStrictEqual(hold.readHolds(a), []);
}));

test('a compact SessionStart inside B keeps the launch worktree A held', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'hold-a');
  const b = harnessWorktreeOf(main, 'hold-b');
  const stamp = (cwd) => hold.stampHoldForCwd({ cwd, sessionId: 's1', env: process.env, ownerBlock });
  assert.strictEqual(stamp(a), 'stamped');
  post.run(enterCtx(b));
  assert.strictEqual(stamp(b), 'stamped');
  post.run({ env: process.env, input: { tool_name: 'ExitWorktree', cwd: b, session_id: 's1' }, cwd: b });
  assert.ok(keys(a).includes(`s1__home__${process.pid}`));
}));

test('a session started in worktree A keeps its hold on A across EnterWorktree B and ExitWorktree', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'hold-a');
  const b = harnessWorktreeOf(main, 'hold-b');
  assert.strictEqual(hold.stampHoldForCwd({ cwd: a, sessionId: 's1', env: process.env, ownerBlock: ownerBlock }), 'stamped');
  post.run(enterCtx(b));
  assert.deepStrictEqual(keys(b), [`s1__main__${process.pid}`]);
  post.run({ env: process.env, input: { tool_name: 'ExitWorktree', cwd: b, session_id: 's1' }, cwd: b });
  assert.deepStrictEqual(hold.readHolds(b), []);
  assert.ok(keys(a).includes(`s1__home__${process.pid}`));
}));
