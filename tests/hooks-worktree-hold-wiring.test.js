// tests/hooks-worktree-hold-wiring.test.js
//
// #4960: session-start, session-end and subagent-stop each call into worktree-hold.js.
// The primitives are pinned in tests/bin-lib/hooks/worktree-hold.test.js; this pins the
// wiring, driving each hook module's real run(ctx).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sessionStart = require('../plugin/bin/lib/hooks/session-start');
const sessionEnd = require('../plugin/bin/lib/hooks/session-end');
const subagentStop = require('../plugin/bin/lib/hooks/subagent-stop');
const hold = require('../plugin/bin/lib/hooks/worktree-hold');
const { gitRepo, harnessWorktreeOf } = require('./helpers/git-fixtures');

const BLOCK = { sessionId: 's1', host: 'h', pid: process.pid, pidSource: 'env', pidStartedAt: 'T', heartbeatAt: 'Z' };
const NO_INSTALL = { readFile: () => { throw Object.assign(new Error('no install (test)'), { code: 'ENOENT' }); } };

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
  const nodePathHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hold-wire-'));
  await sessionStart.run({ input: { session_id: 's1' }, runDir: null, runState: null, cwd: a, superpowersDeps: NO_INSTALL, nodePathHome });
  assert.deepStrictEqual(keys(a), [`s1__home__${process.pid}`]);
}));

test('SessionEnd releases the session\'s holds even when it owns no run dir', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wire-end');
  assert.ok(hold.writeHold(a, { key: `s1__main__${process.pid}`, block: BLOCK }));
  const out = sessionEnd.run({ input: { session_id: 's1', reason: 'other' }, cwd: a, ownedRun: null });
  assert.deepStrictEqual(out, {});
  assert.deepStrictEqual(hold.readHolds(a), []);
}));

test('SubagentStop releases the finished subagent\'s hold and leaves the main thread\'s; its answer is unchanged', () => withPid(() => {
  const main = gitRepo();
  const a = harnessWorktreeOf(main, 'wire-sub-main');
  const b = harnessWorktreeOf(main, 'wire-sub-agent');
  assert.ok(hold.writeHold(a, { key: `s1__main__${process.pid}`, block: BLOCK }));
  assert.ok(hold.writeHold(b, { key: `s1__ag1__${process.pid}`, block: BLOCK, agentId: 'ag1' }));
  const out = subagentStop.run({ input: { session_id: 's1', agent_id: 'ag1' }, cwd: b, ownedRun: null });
  assert.deepStrictEqual(out, {});
  assert.deepStrictEqual(hold.readHolds(b), []);
  assert.deepStrictEqual(keys(a), [`s1__main__${process.pid}`]);
}));
