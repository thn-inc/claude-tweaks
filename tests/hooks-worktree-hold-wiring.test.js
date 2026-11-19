// tests/hooks-worktree-hold-wiring.test.js
//
// #4960: session-start, session-end and subagent-stop each call into worktree-hold.js.
// The primitives are pinned in tests/bin-lib/hooks/worktree-hold.test.js; this pins the
// wiring, driving each hook module's real run(ctx).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const sessionStart = require('../plugin/bin/lib/hooks/session-start');
const sessionEnd = require('../plugin/bin/lib/hooks/session-end');
const subagentStop = require('../plugin/bin/lib/hooks/subagent-stop');
const hold = require('../plugin/bin/lib/hooks/worktree-hold');
const { gitRepo, harnessWorktreeOf } = require('./helpers/git-fixtures');

const BLOCK = { sessionId: 's1', host: 'h', pid: process.pid, pidSource: 'env', pidStartedAt: 'T', heartbeatAt: 'Z' };
const NO_INSTALL = { readFile: () => { throw Object.assign(new Error('no install (test)'), { code: 'ENOENT' }); } };
// #5377: a hook context carries its environment, home and child starter. These are the real ones.
const REAL = { env: process.env, homeDir: () => os.homedir(), spawn: (...args) => require('child_process').spawn(...args) };

function withPid(fn) {
  const prev = process.env.CLAUDE_PID;
  process.env.CLAUDE_PID = String(process.pid);
  const done = () => { if (prev === undefined) delete process.env.CLAUDE_PID; else process.env.CLAUDE_PID = prev; };
  let out;
  try { out = fn(); } catch (e) { done(); throw e; }
  return Promise.resolve(out).finally(done);
}

const keys = (wt) => hold.readHolds(wt).map((e) => e.key);

test('SessionStart in a linked worktree stamps a home hold', () => withPid(async () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wire-start');
  const nodePathHome = scratchDir('ct-hold-wire-');
  await sessionStart.run({ ...REAL, input: { session_id: 's1' }, runDir: null, runState: null, cwd: a, superpowersDeps: NO_INSTALL, nodePathHome });
  assert.deepStrictEqual(keys(a), [`s1__home__${process.pid}`]);
}));

test('SessionEnd releases the session\'s holds even when it owns no run dir', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wire-end');
  assert.ok(hold.writeHold(a, { key: `s1__main__${process.pid}`, block: BLOCK }));
  const out = sessionEnd.run({ env: process.env, input: { session_id: 's1', reason: 'other' }, cwd: a, ownedRun: null });
  assert.deepStrictEqual(out, {});
  assert.deepStrictEqual(hold.readHolds(a), []);
}));

test('SessionEnd with reason clear releases no hold; any other reason still does (/clear keeps the process alive)', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wire-clear-a');
  const b = harnessWorktreeOf(main, 'wire-clear-b');
  assert.ok(hold.writeHold(a, { key: `s1__home__${process.pid}`, block: BLOCK }));
  assert.ok(hold.writeHold(b, { key: `s1__main__${process.pid}`, block: BLOCK }));
  const cleared = sessionEnd.run({ env: process.env, input: { session_id: 's1', reason: 'clear' }, cwd: b, ownedRun: null });
  assert.deepStrictEqual(cleared, {});
  assert.deepStrictEqual(keys(a), [`s1__home__${process.pid}`]);
  assert.deepStrictEqual(keys(b), [`s1__main__${process.pid}`]);
  for (const reason of ['logout', 'other']) {
    assert.deepStrictEqual(sessionEnd.run({ env: process.env, input: { session_id: 's1', reason }, cwd: b, ownedRun: null }), {});
    assert.deepStrictEqual(hold.readHolds(a), [], reason);
    assert.deepStrictEqual(hold.readHolds(b), [], reason);
    assert.ok(hold.writeHold(a, { key: `s1__home__${process.pid}`, block: BLOCK }));
    assert.ok(hold.writeHold(b, { key: `s1__main__${process.pid}`, block: BLOCK }));
  }
}));

// Each of the four hook sites calls through `holdLib.X`, so a mock on the module object reaches it. A throw out
// of the hold library must leave the hook's answer exactly what a clean call returns.
test('a throw out of the hold library never changes any of the four hook sites\' answers', (t) => withPid(async () => {
  const postToolUse = require('../plugin/bin/lib/hooks/post-tool-use');
  const main = gitRepo();
  const enter = (wt) => ({ input: {
    tool_name: 'EnterWorktree', cwd: wt, session_id: 's1',
    tool_response: { content: `Created worktree at ${wt} on branch b. The session is now working in the worktree.` },
  }, cwd: wt, env: process.env });
  const sites = {
    syncHoldForToolUse: (wt) => postToolUse.run(enter(wt)),
    stampHoldForCwd: (wt) => sessionStart.run({
      ...REAL,
      input: { session_id: 's1' }, runDir: null, runState: null, cwd: wt, superpowersDeps: NO_INSTALL,
      nodePathHome: scratchDir('ct-hold-throw-'),
    }),
    releaseSessionHolds: (wt) => sessionEnd.run({ env: process.env, input: { session_id: 's1', reason: 'other' }, cwd: wt, ownedRun: null }),
    releaseAgentHolds: (wt) => subagentStop.run({ env: process.env, input: { session_id: 's1', agent_id: 'ag1' }, cwd: wt, ownedRun: null }),
  };
  for (const [name, call] of Object.entries(sites)) {
    const clean = await call(harnessWorktreeOf(main, `throw-clean-${name}`));
    const mocked = t.mock.method(hold, name, () => { throw new Error('boom'); });
    const thrown = await call(harnessWorktreeOf(main, `throw-boom-${name}`));
    assert.ok(mocked.mock.callCount() >= 1, `${name}: the hook site must reach the mocked hold function`);
    mocked.mock.restore();
    assert.deepStrictEqual(thrown, clean, name);
  }
}));

test('SessionStart: a failed hold write leaves a worktree-hold-failed event in the owned run', () => withPid(async () => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wire-start-failed');
  const holdDir = hold.holdDirOf(a);
  fs.writeFileSync(holdDir, 'not a directory');
  const runDir = scratchDir('ct-hold-failed-run-');
  await sessionStart.run({
      ...REAL,
    input: { session_id: 's1' }, runDir: null, runState: null, cwd: a, superpowersDeps: NO_INSTALL,
    nodePathHome: scratchDir('ct-hold-failed-home-'), ownedRun: { dir: runDir },
  });
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepStrictEqual(events.filter((e) => e.type === 'worktree-hold-failed').map((e) => e.tool), ['SessionStart']);
}));

test('SubagentStop releases the finished subagent\'s hold and leaves the main thread\'s; its answer is unchanged', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wire-sub-main');
  const b = harnessWorktreeOf(main, 'wire-sub-agent');
  assert.ok(hold.writeHold(a, { key: `s1__main__${process.pid}`, block: BLOCK }));
  assert.ok(hold.writeHold(b, { key: `s1__ag1__${process.pid}`, block: BLOCK, agentId: 'ag1' }));
  const out = subagentStop.run({ env: process.env, input: { session_id: 's1', agent_id: 'ag1' }, cwd: b, ownedRun: null });
  assert.deepStrictEqual(out, {});
  assert.deepStrictEqual(hold.readHolds(b), []);
  assert.deepStrictEqual(keys(a), [`s1__main__${process.pid}`]);
}));
