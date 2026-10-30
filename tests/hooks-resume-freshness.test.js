'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  checkResumeFreshness,
  RESUME_FRESHNESS_THRESHOLD_MS,
} = require('../plugin/bin/lib/hooks/resume-freshness');
const { LIVE_WINDOW_MS } = require('../plugin/bin/lib/run-liveness/constants');
const { runLiveness } = require('../plugin/bin/lib/run-liveness');
const { pidStartTime } = require('../plugin/bin/lib/run-liveness/process-probe');
const { gitRepo, linkedWorktreeOf, fixtureGit } = require('./helpers/git-fixtures');

function tmpRunDir(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resume-freshness-'));
  if (state) fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
  return dir;
}

test('checkResumeFreshness: own session is always safe, before any other check', () => {
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: '/does/not/exist' });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-a' });
  assert.deepStrictEqual(result, { safe: true, verdict: 'own-session' });
});

test('checkResumeFreshness: missing run-state.json is safe (nothing recorded to protect)', () => {
  const runDir = tmpRunDir(null);
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-a' });
  assert.deepStrictEqual(result, { safe: true, verdict: 'no-state' });
});

test('checkResumeFreshness: status other than interrupted is always safe (the two-call dispatch handoff shape)', () => {
  const runDir = tmpRunDir({ status: 'active', sessionId: 'sess-a', worktree: '/does/not/exist' });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-b' });
  assert.deepStrictEqual(result, { safe: true, verdict: 'not-interrupted' });
});

test('checkResumeFreshness: interrupted with no recorded worktree is safe (nothing to probe)', () => {
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a' });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-b' });
  assert.deepStrictEqual(result, { safe: true, verdict: 'no-worktree' });
});

test('checkResumeFreshness: interrupted with a worktree path that no longer exists is safe', () => {
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: '/no/such/path/at/all' });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-b' });
  assert.deepStrictEqual(result, { safe: true, verdict: 'worktree-gone' });
});

test('checkResumeFreshness: interrupted with a self-referential symlink worktree (ELOOP) is indeterminate, not worktree-gone', () => {
  // existsSync follows the link, hits ELOOP and reads false, so the old gate
  // reported the worktree as gone. The path exists as a link; only the probe
  // through it fails, so the verdict must fail closed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resume-freshness-loop-'));
  const loop = path.join(dir, 'loop');
  fs.symlinkSync(loop, loop);
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: loop });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-b' });
  assert.equal(result.safe, false);
  assert.equal(result.verdict, 'indeterminate');
});

test('checkResumeFreshness: interrupted + a live worktree lock blocks', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  fixtureGit(['-C', main, 'worktree', 'lock', wt, '--reason', `claude session test (pid ${process.pid} start now)`]);
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: wt });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-b' });
  assert.equal(result.safe, false);
  assert.equal(result.verdict, 'locked');
  assert.match(result.reason, /live process/);
});

test('checkResumeFreshness: interrupted + a recent commit (no lock) blocks', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  fixtureGit(['-C', wt, 'commit', '--allow-empty', '-m', 'recent work', '-q']);
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: wt });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-b', now: Date.now() });
  assert.equal(result.safe, false);
  assert.equal(result.verdict, 'recent-commit');
  assert.ok(result.ageMs < RESUME_FRESHNESS_THRESHOLD_MS);
});

test('checkResumeFreshness: interrupted + a commit older than the threshold, no lock, is safe (stale)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  fixtureGit(['-C', wt, 'commit', '--allow-empty', '-m', 'old work', '-q']);
  const farFuture = Date.now() + RESUME_FRESHNESS_THRESHOLD_MS * 5;
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: wt });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-b', now: farFuture });
  assert.equal(result.safe, true);
  assert.equal(result.verdict, 'stale');
});

test('checkResumeFreshness: interrupted + a worktree path that exists but is not a git repo fails closed to indeterminate, not locked', () => {
  // Exists on disk (passes the existence check) but has no `.git` anywhere
  // above it in the temp-dir tree, so mainCheckoutRoot cannot resolve a root
  // for it. That is "could not determine", not "confirmed locked by a live
  // process" — the two must stay distinguishable because every call site
  // reports `reason` to a human verbatim (#676's final review, Important
  // finding #1). Before that fix this fell through the collapsed
  // isWorktreeLocked boolean and reported `verdict: 'locked'`, which is
  // simply false: there is no lock and no process here.
  const notAWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resume-freshness-not-git-'));
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: notAWorktree });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-b' });
  assert.equal(result.safe, false);
  assert.equal(result.verdict, 'indeterminate');
});

test('RESUME_FRESHNESS_THRESHOLD_MS is on the order of minutes', () => {
  assert.ok(RESUME_FRESHNESS_THRESHOLD_MS >= 60 * 1000);
  assert.ok(RESUME_FRESHNESS_THRESHOLD_MS <= 60 * 60 * 1000);
});

// --- #4420: checkResumeFreshness reads the lock and last-commit answers through
// run-liveness's evidence (blocksResume), so an unknown answer fails closed. ---
const OLD = Date.parse('2026-01-01T00:00:00Z');
const OLD_ENV = { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
const thrower = (msg) => () => { throw new Error(msg); };

// An interrupted run whose recorded worktree is a real, existing directory; the
// lock and commit answers come from `probes`.
function probed(probes, state = {}, now = Date.now()) {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resume-freshness-wt-'));
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: wt, ...state });
  return checkResumeFreshness(runDir, { sessionId: 'sess-b', now, probes });
}

test('AC1.2: an unknown worktree lock is indeterminate, no longer read as unlocked', () => {
  assert.deepStrictEqual(
    probed({ lockInUse: thrower('worktree lock state is unknown for X'), lastCommitAt: () => OLD }),
    { safe: false, verdict: 'indeterminate', reason: 'worktree lock state is unknown for X' },
  );
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  fixtureGit(['-C', main, 'worktree', 'lock', wt, '--reason', 'held']);
  fixtureGit(['-C', wt, 'commit', '--allow-empty', '-m', 'old work', '-q'], { env: OLD_ENV });
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: wt });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-b', now: Date.now() });
  assert.equal(result.safe, false);
  assert.equal(result.verdict, 'indeterminate');
});

test('AC1.2: a worktree git does not list is indeterminate', () => {
  const result = probed({ lockInUse: thrower('W is not listed by git worktree list in R'), lastCommitAt: () => OLD });
  assert.equal(result.verdict, 'indeterminate');
  // Real git, no injected lock probe: a plain subdirectory of a repo resolves a
  // main checkout but is not in its `git worktree list`. The old code read that
  // as unlocked, so with a backdated commit it returned `stale`.
  const main = gitRepo();
  fixtureGit(['-C', main, 'commit', '--allow-empty', '-m', 'old work', '-q'], { env: OLD_ENV });
  const sub = path.join(main, 'sub');
  fs.mkdirSync(sub);
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: sub });
  const real = checkResumeFreshness(runDir, { sessionId: 'sess-b', now: Date.now() });
  assert.equal(real.safe, false);
  assert.equal(real.verdict, 'indeterminate');
  assert.match(real.reason, /not listed/);
});

test('AC1.2: a positive beats an erroring probe — lock error + recent commit is recent-commit, commit error + live lock is locked', () => {
  const now = Date.now();
  const recent = probed(
    { lockInUse: thrower('could not list worktrees from R: git timeout'), lastCommitAt: () => now - 60000 },
    {},
    now,
  );
  assert.equal(recent.verdict, 'recent-commit');
  assert.equal(recent.safe, false);
  assert.equal(recent.ageMs, 60000);
  const locked = probed(
    { lockInUse: () => true, lastCommitAt: thrower('could not read the last commit time of W: git error') },
    {},
    now,
  );
  assert.equal(locked.verdict, 'locked');
  assert.equal(locked.safe, false);
});

test('AC1.2: an orphaned lock is unchanged — the old commit reads stale', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  fixtureGit(['-C', main, 'worktree', 'lock', wt, '--reason', 'claude session test (pid 2147483646 start now)']);
  fixtureGit(['-C', wt, 'commit', '--allow-empty', '-m', 'old work', '-q'], { env: OLD_ENV });
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: wt });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-b', now: Date.now() });
  assert.deepStrictEqual(result, { safe: true, verdict: 'stale' });
});

test('AC3.1: every old indeterminate source fails closed with a non-empty reason', () => {
  const rows = [
    { lockInUse: thrower('could not resolve the main checkout of W') },
    { lockInUse: thrower('could not list worktrees from R: git timeout') },
    { lockInUse: () => false, lastCommitAt: thrower('could not read the last commit time of W: git error') },
    { lockInUse: () => false, lastCommitAt: () => null },
    { lockInUse: () => false, lastCommitAt: () => NaN },
  ];
  for (const probes of rows) {
    const result = probed(probes);
    assert.equal(result.safe, false, JSON.stringify(Object.keys(probes)));
    assert.equal(result.verdict, 'indeterminate');
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0);
  }
});

test('AC3.1: a real unborn-HEAD worktree is indeterminate', () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resume-freshness-unborn-'));
  fixtureGit(['init', '-q', wt]);
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: wt });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-b' });
  assert.equal(result.safe, false);
  assert.equal(result.verdict, 'indeterminate');
  assert.ok(result.reason.length > 0);
});

// Spec Deliverable 7: the real runLiveness on real probes, with and without an owner
// block. The block names this live test process, so its owner-pid and heartbeat
// entries read positive on the real host, and still must not block.
test('AC4.1: real probes — a quiet interrupted run is stale with or without a live owner block', () => {
  for (const withOwner of [false, true]) {
    const wt = linkedWorktreeOf(gitRepo());
    fixtureGit(['-C', wt, 'commit', '--allow-empty', '-m', 'old work', '-q'], { env: OLD_ENV });
    const owner = {
      sessionId: 'sess-a', host: os.hostname(), pid: process.pid, pidSource: 'env',
      pidStartedAt: pidStartTime(process.pid), heartbeatAt: new Date().toISOString(),
    };
    const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: wt, ...(withOwner ? { owner } : {}) });
    if (withOwner) {
      const results = Object.fromEntries(runLiveness(runDir).evidence.map((e) => [e.probe, e.result]));
      assert.equal(results.heartbeat, 'positive', 'fixture: the heartbeat reads live');
      if (owner.pidStartedAt) assert.equal(results['owner-pid'], 'positive', 'fixture: the owner pid reads live');
    }
    assert.deepStrictEqual(checkResumeFreshness(runDir, { sessionId: 'sess-b' }), { safe: true, verdict: 'stale' }, `owner block: ${withOwner}`);
  }
});

test('AC4.1: owner-probe noise never blocks a quiet interrupted run', () => {
  const quiet = { lockInUse: () => false, lastCommitAt: () => OLD };
  const liveOwner = {
    sessionId: 'sess-a', host: 'h', pid: 4242, pidSource: 'env', pidStartedAt: 'T1',
    heartbeatAt: new Date().toISOString(),
  };
  assert.deepStrictEqual(
    probed({ ...quiet, hostname: () => 'h', pidAlive: () => true, pidStartTime: () => 'T1' }, { owner: liveOwner }),
    { safe: true, verdict: 'stale' },
    'fresh heartbeat and live owner pid',
  );
  assert.deepStrictEqual(probed(quiet), { safe: true, verdict: 'stale' }, 'no events.jsonl');
  assert.deepStrictEqual(
    probed(quiet, { owner: { ...liveOwner, sessionId: 'other' } }),
    { safe: true, verdict: 'stale' },
    'owner block from another session',
  );
});

const ALL_PROBES = ['hostname', 'pidAlive', 'pidStartTime', 'lockInUse', 'lastCommitAt', 'ownEventAt', 'pathType'];
function recordingThrowers(calls) {
  const probes = {};
  for (const name of ALL_PROBES) probes[name] = () => { calls.push(name); throw new Error(`${name} must not run`); };
  return probes;
}

test('AC2.1: an active run returns not-interrupted before any liveness probe runs', () => {
  const calls = [];
  const runDir = tmpRunDir({ status: 'active', sessionId: 'sess-a', worktree: os.tmpdir() });
  assert.deepStrictEqual(
    checkResumeFreshness(runDir, { sessionId: 'sess-b', probes: recordingThrowers(calls) }),
    { safe: true, verdict: 'not-interrupted' },
  );
  // runLiveness always calls ownEventAt and pathType, so zero calls means it was never invoked.
  assert.deepStrictEqual(calls, []);
});

test('own session returns before any liveness probe runs', () => {
  const calls = [];
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: os.tmpdir() });
  assert.deepStrictEqual(
    checkResumeFreshness(runDir, { sessionId: 'sess-a', probes: recordingThrowers(calls) }),
    { safe: true, verdict: 'own-session' },
  );
  assert.deepStrictEqual(calls, []);
});

test('AC5.1 AC5.2 AC5.3: the verdict set is exactly today\'s nine, and recent-commit carries ageMs', () => {
  const now = Date.now();
  const quiet = { lockInUse: () => false, lastCommitAt: () => OLD };
  const gone = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resume-freshness-gone-')), 'deleted');
  const recent = probed({ lockInUse: () => false, lastCommitAt: () => now - 60000 }, {}, now);
  const results = [
    checkResumeFreshness(tmpRunDir(null), { sessionId: 'sess-b' }),
    checkResumeFreshness(tmpRunDir({ status: 'interrupted', sessionId: 'sess-a' }), { sessionId: 'sess-a' }),
    checkResumeFreshness(tmpRunDir({ status: 'active', sessionId: 'sess-a' }), { sessionId: 'sess-b' }),
    checkResumeFreshness(tmpRunDir({ status: 'interrupted', sessionId: 'sess-a' }), { sessionId: 'sess-b' }),
    probed(quiet, { worktree: gone }, now),
    probed({ lockInUse: () => true }, {}, now),
    recent,
    probed({ lockInUse: thrower('lock unknown') }, {}, now),
    probed(quiet, {}, now),
  ];
  assert.deepStrictEqual(
    results.map((r) => r.verdict).sort(),
    ['indeterminate', 'locked', 'no-state', 'no-worktree', 'not-interrupted', 'own-session', 'recent-commit', 'stale', 'worktree-gone'],
  );
  assert.equal(recent.ageMs, 60000);
});

test('symlinked worktree path with a live lock is still locked', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  fixtureGit(['-C', main, 'worktree', 'lock', wt, '--reason', `claude session test (pid ${process.pid} start now)`]);
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resume-freshness-link-')), 'wt-link');
  fs.symlinkSync(wt, link);
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: link });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-b' });
  assert.equal(result.verdict, 'locked');
});

test('future-dated commit is recent-commit with a negative ageMs', () => {
  const now = Date.now();
  const result = probed({ lockInUse: () => false, lastCommitAt: () => now + 60000 }, {}, now);
  assert.equal(result.verdict, 'recent-commit');
  assert.equal(result.ageMs, -60000);
});

test('worktree path is a file stays indeterminate', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resume-freshness-file-')), 'a-file');
  fs.writeFileSync(file, 'x');
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: file });
  const result = checkResumeFreshness(runDir, { sessionId: 'sess-b' });
  assert.equal(result.verdict, 'indeterminate');
});

test('RESUME_FRESHNESS_THRESHOLD_MS is the run-liveness live window', () => {
  assert.equal(RESUME_FRESHNESS_THRESHOLD_MS, LIVE_WINDOW_MS);
});
