'use strict';
// #5377: the lib helpers that hook events call read the environment from a parameter, not from
// process.env. Every case puts a sentinel in process.env and a different value in the env it passes,
// and asserts the passed value wins.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ctxLib = require('../plugin/bin/lib/hooks/context');
const { spawnBackgroundIfStale } = require('../plugin/bin/lib/reconcile/background-spawn');
const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
const { checkDispatchPromptGate } = require('../plugin/bin/lib/hooks/dispatch-prompt-gate');
const { findLiveClaim } = require('../plugin/bin/lib/hooks/sibling-sessions');
const { hookEnv } = require('./helpers/hook-event');
const { gitRepo } = require('./helpers/git-fixtures');

// Sets process.env keys for the body, restoring the previous values afterwards.
function withProcessEnv(vars, fn) {
  const before = {};
  for (const k of Object.keys(vars)) before[k] = process.env[k];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k];
    }
  }
}

const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `ct-5377-${label}-`));

test('requireEnv throws on a context without env and returns the object otherwise', () => {
  for (const bad of [{}, { env: null }, { env: 'x' }, undefined, null]) {
    assert.throws(() => ctxLib.requireEnv(bad), { name: 'TypeError', message: /hook context has no env/ });
  }
  const env = { A: '1' };
  assert.strictEqual(ctxLib.requireEnv({ env }), env);
});

test('spawnBackgroundIfStale passes the given env and session id to the given spawn', () => {
  const root = tmp('spawn');
  const calls = [];
  const fakeSpawn = (file, args, options) => {
    calls.push({ file, args, options });
    return { on() {}, unref() {} };
  };
  const realSpawn = cp.spawn;
  cp.spawn = () => { throw new Error('the real child_process.spawn must not be called'); };
  try {
    withProcessEnv({ CT_5377_SENTINEL: 'process' }, () => {
      const r = spawnBackgroundIfStale({
        root, cwd: root, sessionId: 'sess-1', env: { CT_5377_SENTINEL: 'given' }, spawn: fakeSpawn,
      });
      assert.deepStrictEqual(r, { spawned: true, reason: 'spawned' });
    });
  } finally {
    cp.spawn = realSpawn;
  }
  assert.strictEqual(calls.length, 1);
  const { options } = calls[0];
  assert.strictEqual(options.env.CT_5377_SENTINEL, 'given');
  assert.strictEqual(options.env.CLAUDE_TWEAKS_SESSION_ID, 'sess-1');
  assert.strictEqual(options.cwd, root);
  assert.strictEqual(options.detached, true);
  assert.strictEqual(options.windowsHide, true);
});

test('spawnBackgroundIfStale without a session id hands the given env to the spawn unchanged', () => {
  const root = tmp('spawn-nosess');
  const env = { CT_5377_SENTINEL: 'given' };
  let seen;
  spawnBackgroundIfStale({ root, cwd: root, env, spawn: (f, a, o) => { seen = o.env; return { on() {}, unref() {} }; } });
  assert.strictEqual(seen, env);
});

test('spawnBackgroundIfStale throws without env, even when the spawn would have failed or there is no root', () => {
  const root = tmp('spawn-noenv');
  for (const env of [undefined, null, 'x']) {
    assert.throws(() => spawnBackgroundIfStale({ root, cwd: root, env }), { name: 'TypeError', message: /requires an env object/ });
  }
  assert.throws(() => spawnBackgroundIfStale({ root: null, cwd: root }), TypeError);
  assert.throws(() => spawnBackgroundIfStale(), TypeError);
});

test('ownerBlock and refreshOwnerBlock read the owner pid from the passed env', () => {
  const deps = { hostname: () => 'h', pidStartTime: () => 'T4242', isPidAlive: () => true };
  withProcessEnv({ CLAUDE_PID: '9999' }, () => {
    const block = ctxLib.ownerBlock({ sessionId: 's', env: { CLAUDE_PID: '4242' }, deps });
    assert.strictEqual(block.pid, 4242);
    assert.strictEqual(block.pidSource, 'env');

    // patchWithOwnerBlock hands its env to ownerBlock.
    const patched = ctxLib.patchWithOwnerBlock({}, 's', { env: { CLAUDE_PID: '4242' } })({});
    assert.strictEqual(patched.owner.pid, 4242);

    // refreshOwnerBlock: the stamped pid matches the passed env's, not process.env's, so an old
    // heartbeat is refreshed in place. Reading process.env would see pid 9999 and not write.
    const project = tmp('owner');
    const runDir = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
    fs.mkdirSync(runDir, { recursive: true });
    const old = '2026-10-24T06:00:00.000Z';
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
      sessionId: 's', owner: { sessionId: 's', host: 'h', pid: 4242, pidSource: 'env', pidStartedAt: 'T4242', heartbeatAt: old },
    }));
    const result = ctxLib.refreshOwnerBlock(
      { input: { session_id: 's' }, ownedRun: { dir: runDir, attribution: 'session' } },
      { now: Date.parse(old) + 3_600_000, env: { CLAUDE_PID: '4242' }, deps },
    );
    assert.strictEqual(result, 'heartbeat');
  });
});

test('refreshOwnerBlock takes the context env when no env option is passed, and throws when there is neither', () => {
  const deps = { hostname: () => 'h', pidStartTime: () => 'T4242', isPidAlive: () => true };
  const project = tmp('owner-ctx');
  const runDir = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-2');
  fs.mkdirSync(runDir, { recursive: true });
  const old = '2026-10-24T06:00:00.000Z';
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    sessionId: 's', owner: { sessionId: 's', host: 'h', pid: 4242, pidSource: 'env', pidStartedAt: 'T4242', heartbeatAt: old },
  }));
  const base = { input: { session_id: 's' }, ownedRun: { dir: runDir, attribution: 'session' } };
  withProcessEnv({ CLAUDE_PID: '9999' }, () => {
    assert.strictEqual(
      ctxLib.refreshOwnerBlock({ ...base, env: { CLAUDE_PID: '4242' } }, { now: Date.parse(old) + 3_600_000, deps }),
      'heartbeat',
    );
  });
  assert.throws(() => ctxLib.refreshOwnerBlock(base, { deps }), { name: 'TypeError', message: /hook context has no env/ });
});

test('the lock wait comes from the passed env', () => {
  withProcessEnv({ CLAUDE_TWEAKS_LOCK_WAIT_MS: '60000' }, () => {
    assert.strictEqual(ctxLib.resolveLockWaitMs({ CLAUDE_TWEAKS_LOCK_WAIT_MS: '0' }), 0);
    assert.strictEqual(ctxLib.resolveLockWaitMs({}), 500);
    assert.strictEqual(ctxLib.resolveLockWaitMs(), 60000, 'no env: the inherited environment');

    // Through writeRunState: with a held lock, a zero budget makes one attempt and proceeds
    // unlocked. Counted by attempts, not time; the lock is released after a few attempts so a
    // regression (the 60 s process.env budget) ends the test instead of hanging it.
    const project = tmp('lock');
    const runDir = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-3');
    const lockDir = path.join(runDir, '.run-state.lock');
    fs.mkdirSync(lockDir, { recursive: true });
    let attempts = 0;
    const realMkdir = fs.mkdirSync;
    fs.mkdirSync = (p, ...rest) => {
      if (p === lockDir && ++attempts === 4) fs.rmdirSync(lockDir);
      return realMkdir(p, ...rest);
    };
    try {
      ctxLib.writeRunState(runDir, { a: 1 }, { env: { CLAUDE_TWEAKS_LOCK_WAIT_MS: '0' } });
    } finally {
      fs.mkdirSync = realMkdir;
    }
    assert.strictEqual(attempts, 1, 'the passed env\'s zero budget is honoured, not the process.env one');
  });
});

test('repoInfo consults the store the passed env names', () => {
  const repo = tmp('repo');
  cp.execFileSync('git', ['init', '-q', repo], { env: hookEnv(), stdio: 'ignore' });
  const processStore = path.join(tmp('store-process'), 'store.json');
  const givenStore = path.join(tmp('store-given'), 'store.json');
  withProcessEnv({ CT_HOOKS_REPO_INFO_STORE: processStore }, () => {
    const info = wtDetect.repoInfo(repo, {}, { env: hookEnv({ CT_HOOKS_REPO_INFO_STORE: givenStore }) });
    assert.ok(info.repoRoot, 'the repo is found');
  });
  assert.ok(fs.existsSync(givenStore), 'the passed env\'s store was written');
  assert.ok(!fs.existsSync(processStore), 'process.env\'s store was not touched');

  // The same call again is answered from the store the first one wrote under the passed env,
  // with no git spawn; the lookup reads the passed env's store, not process.env's.
  // A fresh module pair, so the in-process memo is empty and only the store can answer.
  for (const m of ['repo-info-cache', 'worktree-detect']) delete require.cache[require.resolve('../plugin/bin/lib/hooks/' + m)];
  const freshDetect = require('../plugin/bin/lib/hooks/worktree-detect');
  let spawns = 0;
  const realExec = cp.execFileSync;
  cp.execFileSync = (...args) => { spawns++; return realExec(...args); };
  try {
    withProcessEnv({ CT_HOOKS_REPO_INFO_STORE: processStore }, () => {
      assert.ok(freshDetect.repoInfo(repo, {}, { env: hookEnv({ CT_HOOKS_REPO_INFO_STORE: givenStore }) }).repoRoot);
    });
  } finally {
    cp.execFileSync = realExec;
  }
  assert.strictEqual(spawns, 0, 'answered from the passed env\'s memo/store');
});

test('dispatch-prompt-gate reads the plugin root and test mode from the passed env', () => {
  const project = fs.realpathSync(tmp('gate'));
  fs.mkdirSync(path.join(project, '.git'));
  const runId = '2026-11-15T120000-spec-1';
  const runDir = path.join(project, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ dispatched: true, dispatchSessionId: 'S', status: 'active' }));
  const ctx = (env) => ({
    cwd: project,
    env,
    input: { tool_name: 'Agent', session_id: 'S', tool_input: { prompt: `Work on run ${runId} by hand` } },
  });
  const reasons = [];
  withProcessEnv({ CLAUDE_PLUGIN_ROOT: '/process-root', CT_HOOKS_TEST_MODE: '0' }, () => {
    const out = checkDispatchPromptGate(ctx({ CLAUDE_PLUGIN_ROOT: '/given-root', CT_HOOKS_TEST_MODE: '1' }), {}, (reason) => { reasons.push(reason); return { denied: true }; });
    assert.deepStrictEqual(out, { denied: true });
  });
  assert.match(reasons[0], /\/given-root\/bin\/dispatch-prompt\.js/);
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].reason, 'missing-marker');
  assert.strictEqual(events[0].test, true, 'the test tag follows the passed env');
  assert.throws(() => checkDispatchPromptGate({ input: {} }, {}, () => ({})), { name: 'TypeError', message: /hook context has no env/ });
});

test('sibling-sessions reads the session id from the passed env', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  const blob = JSON.stringify({ runId: 'r-77', sessionId: 'given-sess', host: 'box', claimedAt: new Date(now).toISOString() });
  withProcessEnv({ CLAUDE_CODE_SESSION_ID: 'process-sess' }, () => {
    // The claim is held by the session the passed env names: it is the caller's own, so no sibling.
    assert.strictEqual(findLiveClaim('77', { readClaim: () => blob, now, env: { CLAUDE_CODE_SESSION_ID: 'given-sess' } }), null);
    // The claim is held by another session than the passed env's.
    assert.strictEqual(findLiveClaim('77', { readClaim: () => blob, now, env: { CLAUDE_CODE_SESSION_ID: 'other' } }).sessionId, 'given-sess');
    // An explicit sessionId still wins over any env.
    assert.strictEqual(findLiveClaim('77', { readClaim: () => blob, now, sessionId: 'given-sess', env: { CLAUDE_CODE_SESSION_ID: 'other' } }), null);
  });
});

test('stampAdHocRunDirForDenial stamps the owner pid and block from the context env', () => {
  withProcessEnv({ CLAUDE_PID: '9999' }, () => {
    const stamped = ctxLib.stampAdHocRunDirForDenial({
      env: { CLAUDE_PID: '4242' }, input: { session_id: 'sess-5377-denial' }, cwd: gitRepo(), ownedRun: {},
    });
    const state = ctxLib.readRunState(stamped);
    assert.strictEqual(state.ownerPid, 4242);
    assert.strictEqual(state.owner.pid, 4242);
  });
  assert.throws(() => ctxLib.stampAdHocRunDirForDenial({ input: { session_id: 's' }, cwd: '/x', ownedRun: {} }), TypeError);
});
