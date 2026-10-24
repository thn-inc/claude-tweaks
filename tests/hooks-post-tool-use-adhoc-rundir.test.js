// tests/hooks-post-tool-use-adhoc-rundir.test.js
//
// #500's ad-hoc-session run-dir stamping: an EnterWorktree call that finds
// no owned run dir yet mints a lightweight standalone one and stamps this
// session as its owner, so wd-deny/gate-denial/contract-violation/
// ask-user-question incurred later in the SAME ad-hoc session (one that
// never reaches a formal /claude-tweaks:build or /flow pipeline) has
// somewhere to land — see bin/lib/hooks/post-tool-use.js's
// stampAdHocRunDir and skills/reflect/full-mode.md's Friction Lens section
// (the read side, via bin/friction-events.js).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const post = require('../plugin/bin/lib/hooks/post-tool-use');
const ctxLib = require('../plugin/bin/lib/hooks/context');
const { sessionTmpRoot, sessionTmpPath } = require('../plugin/bin/lib/session-tmp');
const { gitRepo, harnessWorktreeOf } = require('./helpers/git-fixtures');

// The non-EnterWorktree rate-limit marker (#1333) lives under a real,
// persistent OS tmp path keyed only by session id (sessionTmpRoot), the same
// convention every other session-tmp consumer in this repo uses — see
// tests/backlog-refine-foldin-no-truncation.test.js for the identical
// cleanup pattern. Every test below that exercises the non-EnterWorktree
// path uses its own unique session id AND cleans that id's tmp root first,
// so a marker left behind by an earlier run of this same suite (or a
// concurrent one) can never leak into a later test's expectations.
function cleanSessionTmp(sessionId) {
  const root = sessionTmpRoot(sessionId);
  if (root) fs.rmSync(root, { recursive: true, force: true });
}

function createdAt(wt) {
  return { content: `Created worktree at ${wt} on branch wt-branch. The session is now working in the worktree.` };
}

function enterWorktreeCtx(wt, { toolResponse, ownedRun, sessionId = 'sess-adhoc-1' } = {}) {
  const input = { tool_name: 'EnterWorktree', cwd: wt };
  if (toolResponse !== undefined) input.tool_response = toolResponse;
  if (sessionId !== undefined) input.session_id = sessionId;
  return { input, cwd: wt, ownedRun };
}

function pipelinesDir(main) {
  return path.join(main, '.claude-tweaks', 'pipelines');
}

function adhocDirs(main) {
  try {
    return fs.readdirSync(pipelinesDir(main)).filter((n) => n.endsWith('-adhoc-standalone'));
  } catch {
    return [];
  }
}

test('stamps a lightweight run dir when this session owns none yet', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt) }));
  const dirs = adhocDirs(main);
  assert.strictEqual(dirs.length, 1);
  const state = ctxLib.readRunState(path.join(pipelinesDir(main), dirs[0]));
  assert.strictEqual(state.status, 'active');
  assert.strictEqual(state.sessionId, 'sess-adhoc-1');
  assert.strictEqual(fs.realpathSync(state.worktree), wt);
});

// #3845: the ad-hoc mint stamps the session's process as the run's owner so the
// nested-session guard in session-end.js covers it; an unknown pid writes nothing.
test('#3845: the ad-hoc stamp records ownerPid from CLAUDE_PID, and omits it when the pid is unknown', () => {
  const prior = process.env.CLAUDE_PID;
  try {
    process.env.CLAUDE_PID = '4242';
    const main = gitRepo();
    const wt = harnessWorktreeOf(main);
    post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt) }));
    assert.strictEqual(ctxLib.readRunState(path.join(pipelinesDir(main), adhocDirs(main)[0])).ownerPid, 4242);

    delete process.env.CLAUDE_PID;
    const main2 = gitRepo();
    const wt2 = harnessWorktreeOf(main2);
    post.run(enterWorktreeCtx(wt2, { toolResponse: createdAt(wt2), sessionId: 'sess-adhoc-3845-b' }));
    assert.ok(!('ownerPid' in ctxLib.readRunState(path.join(pipelinesDir(main2), adhocDirs(main2)[0]))));
  } finally {
    if (prior === undefined) delete process.env.CLAUDE_PID;
    else process.env.CLAUDE_PID = prior;
  }
});

test('AC1.1/AC1.2: stampAdHocRunDir writes the owner block', () => {
  const prior = process.env.CLAUDE_PID;
  try {
    process.env.CLAUDE_PID = String(process.pid);
    const main = gitRepo();
    const wt = harnessWorktreeOf(main);
    post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt), sessionId: 'sess-owner-block-a' }));
    const { owner } = ctxLib.readRunState(path.join(pipelinesDir(main), adhocDirs(main)[0]));
    assert.strictEqual(owner.sessionId, 'sess-owner-block-a');
    assert.strictEqual(owner.host, require('os').hostname());
    assert.strictEqual(owner.pid, process.pid);
    assert.strictEqual(owner.pidSource, 'env');
    if (process.platform !== 'win32') assert.strictEqual(typeof owner.pidStartedAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(owner.heartbeatAt)));

    // A pid that is gone: a short child that has already exited.
    const dead = cp.spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid;
    process.env.CLAUDE_PID = String(dead);
    const main2 = gitRepo();
    const wt2 = harnessWorktreeOf(main2);
    post.run(enterWorktreeCtx(wt2, { toolResponse: createdAt(wt2), sessionId: 'sess-owner-block-b' }));
    const deadOwner = ctxLib.readRunState(path.join(pipelinesDir(main2), adhocDirs(main2)[0])).owner;
    assert.strictEqual(deadOwner.pid, dead);
    assert.strictEqual(deadOwner.pidStartedAt, null, 'a pid that is gone has no start time');
  } finally {
    if (prior === undefined) delete process.env.CLAUDE_PID;
    else process.env.CLAUDE_PID = prior;
  }
});

test('does not stamp when ctx.ownedRun.dir already resolves (a formal pipeline already claimed this worktree)', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const existingRun = fs.mkdtempSync(path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'ct-owned-')), 'run-'));
  post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt), ownedRun: { dir: existingRun } }));
  assert.deepStrictEqual(adhocDirs(main), []);
});

test('does not stamp when the hook payload carries no session_id (nothing to stamp ownership against)', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt), sessionId: null }));
  assert.deepStrictEqual(adhocDirs(main), []);
});

test('does not fire for a tool other than EnterWorktree when cwd is the main checkout (not any worktree)', () => {
  cleanSessionTmp('sess-adhoc-mainonly');
  const main = gitRepo();
  post.run({ input: { tool_name: 'ExitWorktree', cwd: main, session_id: 'sess-adhoc-mainonly' }, cwd: main });
  assert.deepStrictEqual(adhocDirs(main), []);
});

// ---- widened non-EnterWorktree trigger (#1333) -------------------------

test('stamps via the widened trigger: a non-EnterWorktree tool call from cwd inside a real (non-main) worktree', () => {
  cleanSessionTmp('sess-adhoc-nonEW-1');
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  // No EnterWorktree call anywhere in this test — simulates a worktree
  // created by a tool other than claude-tweaks' own EnterWorktree (another
  // plugin's worktree-management skill, or a raw `git worktree add`).
  post.run({ input: { tool_name: 'Write', cwd: wt, session_id: 'sess-adhoc-nonEW-1' }, cwd: wt });
  const dirs = adhocDirs(main);
  assert.strictEqual(dirs.length, 1);
  const state = ctxLib.readRunState(path.join(pipelinesDir(main), dirs[0]));
  assert.strictEqual(state.status, 'active');
  assert.strictEqual(state.sessionId, 'sess-adhoc-nonEW-1');
  assert.strictEqual(fs.realpathSync(state.worktree), wt);
});

test('non-EnterWorktree trigger: does not stamp when this session already owns a run dir', () => {
  cleanSessionTmp('sess-adhoc-nonEW-owned');
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const existingRun = fs.mkdtempSync(path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'ct-owned-')), 'run-'));
  post.run({
    input: { tool_name: 'Write', cwd: wt, session_id: 'sess-adhoc-nonEW-owned' },
    cwd: wt,
    ownedRun: { dir: existingRun },
  });
  assert.deepStrictEqual(adhocDirs(main), []);
});

test('non-EnterWorktree trigger: git worktree list is not invoked on every ordinary tool call — rate-limited to at most once per session', (t) => {
  cleanSessionTmp('sess-adhoc-ratelimit');
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const realExecFileSync = cp.execFileSync;
  const worktreeListCalls = [];
  t.mock.method(cp, 'execFileSync', (cmd, args, opts) => {
    if (cmd === 'git' && Array.isArray(args) && args.includes('worktree') && args.includes('list')) {
      worktreeListCalls.push(args);
    }
    return realExecFileSync(cmd, args, opts);
  });

  post.run({ input: { tool_name: 'Write', cwd: wt, session_id: 'sess-adhoc-ratelimit' }, cwd: wt });
  const dirs = adhocDirs(main);
  assert.strictEqual(dirs.length, 1, 'first call should stamp once');

  // ctx.ownedRun is unset on this second call too (this test simulates the
  // dispatcher not yet having recomputed it), so without the rate-limit
  // marker this would run `git worktree list` — and, absent the ownedRun
  // guard, re-derive the same worktree path — a second time.
  post.run({ input: { tool_name: 'Write', cwd: wt, session_id: 'sess-adhoc-ratelimit' }, cwd: wt });

  assert.strictEqual(worktreeListCalls.length, 1, `expected exactly 1 'git worktree list' spawn across two calls, got ${worktreeListCalls.length}`);
  assert.strictEqual(adhocDirs(main).length, 1, 'second call must not mint a second ad-hoc dir');
});

test('non-EnterWorktree trigger: an ordinary tool call from a session already checked this run never re-invokes git worktree list', (t) => {
  cleanSessionTmp('sess-adhoc-checked-once');
  const main = gitRepo();
  const realExecFileSync = cp.execFileSync;
  const worktreeListCalls = [];
  t.mock.method(cp, 'execFileSync', (cmd, args, opts) => {
    if (cmd === 'git' && Array.isArray(args) && args.includes('worktree') && args.includes('list')) {
      worktreeListCalls.push(args);
    }
    return realExecFileSync(cmd, args, opts);
  });

  // First call from the main checkout rules this session out ("not a
  // worktree") and writes the marker.
  post.run({ input: { tool_name: 'Write', cwd: main, session_id: 'sess-adhoc-checked-once' }, cwd: main });
  assert.strictEqual(worktreeListCalls.length, 1);

  // A second, later call in the same session must not re-run the check.
  post.run({ input: { tool_name: 'Write', cwd: main, session_id: 'sess-adhoc-checked-once' }, cwd: main });
  assert.strictEqual(worktreeListCalls.length, 1, `expected the second call to skip the git call entirely, got ${worktreeListCalls.length} total calls`);
  assert.deepStrictEqual(adhocDirs(main), []);
});

test('a second EnterWorktree in the same session does not mint a second ad-hoc dir (ownedRun now resolves to the first stamp)', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt) }));
  const [first] = adhocDirs(main);
  const firstDir = path.join(pipelinesDir(main), first);
  // Simulates the dispatcher recomputing ctx.ownedRun on the NEXT hook call,
  // now that resolveRun's session-owner scan finds the stamp just written.
  const owned = ctxLib.resolveRun(main, {}, 'sess-adhoc-1');
  assert.strictEqual(owned.dir, firstDir);
  post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt), ownedRun: owned }));
  assert.deepStrictEqual(adhocDirs(main), [first]);
});

test('never throws on an unresolvable worktree path — returns {} rather than crashing', () => {
  const out = post.run({ input: { tool_name: 'EnterWorktree', cwd: '/this/path/does/not/exist/at/all', session_id: 'sess-x' } });
  assert.deepStrictEqual(out, {});
});

// ---- #1864: ExitWorktree(remove) must not write the rate-limit marker against
// a lookup that never actually ran -----------------------------------------

test('ExitWorktree(remove): does not write the rate-limit marker or mint a run dir when ctx.cwd no longer exists on disk', (t) => {
  cleanSessionTmp('sess-adhoc-exitwt-gone');
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  // Simulate the directory having just been torn down by the remove itself —
  // ExitWorktree(action:'remove')'s PostToolUse fires with `cwd` still naming
  // the now-deleted path (the bug report's exact shape), not the main checkout.
  fs.rmSync(wt, { recursive: true, force: true });

  const realExecFileSync = cp.execFileSync;
  const worktreeListCalls = [];
  t.mock.method(cp, 'execFileSync', (cmd, args, opts) => {
    if (cmd === 'git' && Array.isArray(args) && args.includes('worktree') && args.includes('list')) {
      worktreeListCalls.push(args);
    }
    return realExecFileSync(cmd, args, opts);
  });

  post.run({ input: { tool_name: 'ExitWorktree', cwd: wt, session_id: 'sess-adhoc-exitwt-gone' }, cwd: wt });

  assert.strictEqual(worktreeListCalls.length, 0, 'the porcelain lookup must never even be attempted against a gone directory');
  assert.deepStrictEqual(adhocDirs(main), []);
  const markerPath = sessionTmpPath('sess-adhoc-exitwt-gone', 'adhoc-worktree-checked');
  assert.ok(!fs.existsSync(markerPath), 'the rate-limit marker must not be written when the lookup could not run');
});

test('ExitWorktree(remove) followed by a raw `git worktree add` in the same session: the later worktree still gets stamped', () => {
  cleanSessionTmp('sess-adhoc-exitwt-then-add');
  const main = gitRepo();
  const goneWt = harnessWorktreeOf(main);
  fs.rmSync(goneWt, { recursive: true, force: true });

  // First: the ExitWorktree(remove) event against the now-deleted worktree —
  // must not permanently defeat the mechanism for this session (see the test
  // above for the marker-write assertion in isolation).
  post.run({ input: { tool_name: 'ExitWorktree', cwd: goneWt, session_id: 'sess-adhoc-exitwt-then-add' }, cwd: goneWt });
  assert.deepStrictEqual(adhocDirs(main), []);

  // Then: a later, genuinely new worktree created via a raw `git worktree
  // add` (bypassing EnterWorktree) in the SAME session must still be stamped
  // by stampAdHocRunDir's widened non-EnterWorktree trigger (#1333) — this is
  // exactly the failure scenario #1864's Deliverables call out.
  const newWt = harnessWorktreeOf(main);
  post.run({ input: { tool_name: 'Write', cwd: newWt, session_id: 'sess-adhoc-exitwt-then-add' }, cwd: newWt });

  const dirs = adhocDirs(main);
  assert.strictEqual(dirs.length, 1, 'the later worktree must get stamped, not silently skipped');
  const state = ctxLib.readRunState(path.join(pipelinesDir(main), dirs[0]));
  assert.strictEqual(state.status, 'active');
  assert.strictEqual(state.sessionId, 'sess-adhoc-exitwt-then-add');
  assert.strictEqual(fs.realpathSync(state.worktree), newWt);
});

test('#2783: stamps even when ctx.ownedRun is only a fallback GUESS (an unrelated unowned run), not this session\'s own', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const guess = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ct-guess-'));
  post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt), ownedRun: { dir: guess, attribution: 'fallback' }, sessionId: 'sess-2783-a' }));
  const dirs = adhocDirs(main);
  assert.strictEqual(dirs.length, 1);
  assert.strictEqual(ctxLib.readRunState(path.join(pipelinesDir(main), dirs[0])).sessionId, 'sess-2783-a');
});

function seedRun(main, name, state) {
  const dir = path.join(pipelinesDir(main), name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.md'), '');
  ctxLib.writeRunState(dir, state);
  return dir;
}

test('#2783: a formal run owned by this session wins resolveRun over a NEWER ad-hoc dir of the same session', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const formal = seedRun(main, '2026-10-01T000000-spec-42', { status: 'active', sessionId: 'sess-2783-b', worktree: wt });
  seedRun(main, '2026-10-02T000000-adhoc-standalone', { status: 'active', sessionId: 'sess-2783-b', worktree: wt });
  const r = ctxLib.resolveRun(wt, {}, 'sess-2783-b');
  assert.strictEqual(fs.realpathSync(r.dir), fs.realpathSync(formal));
  assert.strictEqual(r.attribution, 'session');
});

test('#2783: with only an ad-hoc dir owned, resolveRun still returns it with session attribution', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const adhoc = seedRun(main, '2026-10-02T000000-adhoc-standalone', { status: 'active', sessionId: 'sess-2783-c', worktree: wt });
  const r = ctxLib.resolveRun(wt, {}, 'sess-2783-c');
  assert.strictEqual(fs.realpathSync(r.dir), fs.realpathSync(adhoc));
  assert.strictEqual(r.attribution, 'session');
});

test('#2783 F4: a stale formal run of this session (its worktree since removed) never beats the ad-hoc dir bound to the caller\'s own worktree', () => {
  const main = gitRepo();
  const w1 = harnessWorktreeOf(main);
  const w2 = harnessWorktreeOf(main);
  seedRun(main, '2026-10-01T000000-spec-1', { status: 'active', sessionId: 'sess-2783-d', worktree: w1 });
  const a2 = seedRun(main, '2026-10-02T000000-adhoc-standalone', { status: 'active', sessionId: 'sess-2783-d', worktree: w2 });
  const before = ctxLib.resolveRun(w2, {}, 'sess-2783-d');
  assert.strictEqual(fs.realpathSync(before.dir), fs.realpathSync(a2), 'precondition: R1 is foreign while W1 lives');
  cp.execFileSync('git', ['-C', main, 'worktree', 'remove', '--force', w1]);
  const after = ctxLib.resolveRun(w2, {}, 'sess-2783-d');
  assert.strictEqual(fs.realpathSync(after.dir), fs.realpathSync(a2), 'an indeterminate older formal run must not displace the ad-hoc dir');
  assert.strictEqual(after.attribution, 'session');
});
