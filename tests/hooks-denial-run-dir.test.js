'use strict';
// tests/hooks-denial-run-dir.test.js — #2783 / #2813: a denial must never be
// logged into resolveRun's GUESSED ('fallback') run dir when a session-owned
// ad-hoc dir can be minted instead. context.js's resolveDenialRunDir is the
// one resolver every pre-tool-use denial site uses.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ctxLib = require('../plugin/bin/lib/hooks/context');
const { gitRepo, harnessWorktreeOf } = require('./helpers/git-fixtures');

function adhocDirs(main) {
  try {
    return fs.readdirSync(path.join(main, '.claude-tweaks', 'pipelines')).filter((n) => n.endsWith('-adhoc-standalone'));
  } catch { return []; }
}

test('isTrustedOwnedRun: session/env attribution is trusted, fallback and empty are not', () => {
  assert.strictEqual(ctxLib.isTrustedOwnedRun({ dir: '/r', attribution: 'session' }), true);
  assert.strictEqual(ctxLib.isTrustedOwnedRun({ dir: '/r', attribution: 'env' }), true);
  assert.strictEqual(ctxLib.isTrustedOwnedRun({ dir: '/r', attribution: 'fallback' }), false);
  assert.strictEqual(ctxLib.isTrustedOwnedRun({ dir: null, attribution: null }), false);
  assert.strictEqual(ctxLib.isTrustedOwnedRun(undefined), false);
});

test('resolveDenialRunDir: a trusted owned run is returned as-is, nothing minted', () => {
  const main = gitRepo();
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-owned-'));
  const r = ctxLib.resolveDenialRunDir({ input: { session_id: 'sess-drd-1' }, cwd: main, ownedRun: { dir: owned, attribution: 'session' } });
  assert.deepStrictEqual(r, { dir: owned, attribution: 'session' });
  assert.deepStrictEqual(adhocDirs(main), []);
});

test('resolveDenialRunDir: a fallback guess is NOT used when an ad-hoc dir can be minted', () => {
  const main = gitRepo();
  const guess = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-guess-'));
  const r = ctxLib.resolveDenialRunDir({ input: { session_id: 'sess-drd-2' }, cwd: main, ownedRun: { dir: guess, attribution: 'fallback' } });
  const dirs = adhocDirs(main);
  assert.strictEqual(dirs.length, 1);
  assert.strictEqual(fs.realpathSync(r.dir), fs.realpathSync(path.join(main, '.claude-tweaks', 'pipelines', dirs[0])));
  assert.strictEqual(r.attribution, undefined);
  assert.strictEqual(ctxLib.readRunState(r.dir).sessionId, 'sess-drd-2');
});

test('resolveDenialRunDir: falls back to the guess (attribution kept) only when minting is impossible', () => {
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-notrepo-'));
  const guess = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-guess-'));
  const r = ctxLib.resolveDenialRunDir({ input: { session_id: 'sess-drd-3' }, cwd: notRepo, ownedRun: { dir: guess, attribution: 'fallback' } });
  assert.deepStrictEqual(r, { dir: guess, attribution: 'fallback' });
});

test('stampAdHocRunDirForDenial: a fallback-attributed ownedRun no longer short-circuits the mint', () => {
  const main = gitRepo();
  const guess = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-guess-'));
  const stamped = ctxLib.stampAdHocRunDirForDenial({ input: { session_id: 'sess-drd-4' }, cwd: main, ownedRun: { dir: guess, attribution: 'fallback' } });
  assert.notStrictEqual(stamped, guess);
  assert.strictEqual(adhocDirs(main).length, 1);
});

// #3845: an ad-hoc mint stamps the session's process as the run's owner, so the
// nested-session guard in session-end.js covers it like a record-worktree run.
test('#3845: stampAdHocRunDirForDenial stamps ownerPid from CLAUDE_PID and omits it when the pid is unknown', () => {
  const prior = process.env.CLAUDE_PID;
  try {
    process.env.CLAUDE_PID = '4242';
    const stamped = ctxLib.stampAdHocRunDirForDenial({ input: { session_id: 'sess-3845-denial-a' }, cwd: gitRepo(), ownedRun: {} });
    assert.strictEqual(ctxLib.readRunState(stamped).ownerPid, 4242);

    delete process.env.CLAUDE_PID;
    const unstamped = ctxLib.stampAdHocRunDirForDenial({ input: { session_id: 'sess-3845-denial-b' }, cwd: gitRepo(), ownedRun: {} });
    assert.ok(!('ownerPid' in ctxLib.readRunState(unstamped)));
  } finally {
    if (prior === undefined) delete process.env.CLAUDE_PID;
    else process.env.CLAUDE_PID = prior;
  }
});

function seed(main, name, state) {
  const dir = path.join(main, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.md'), '');
  ctxLib.writeRunState(dir, state);
  return dir;
}

test('findAdHocRunsBySessionId: only this session\'s -adhoc-standalone dirs, never another session\'s or a formal run', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const mine = seed(main, '2026-10-02T000000-adhoc-standalone', { status: 'active', sessionId: 'S1', worktree: '/gone/wt' });
  seed(main, '2026-10-03T000000-adhoc-standalone', { status: 'active', sessionId: 'S2', worktree: '/gone/wt2' });
  seed(main, '2026-10-01T000000-spec-7', { status: 'active', sessionId: 'S1', worktree: wt });
  const hits = ctxLib.findAdHocRunsBySessionId(main, 'S1');
  assert.deepStrictEqual(hits.map((h) => fs.realpathSync(h.runDir)), [fs.realpathSync(mine)]);
  assert.deepStrictEqual(ctxLib.findAdHocRunsBySessionId(main, 'S1', mine), []);
  assert.deepStrictEqual(ctxLib.findAdHocRunsBySessionId(main, ''), []);
});

test('#2783 F3: the session lookup skips an ad-hoc dir whose worktree is still live — session-id equality is not ownership', () => {
  const main = gitRepo();
  const liveSibling = harnessWorktreeOf(main);
  seed(main, '2026-10-02T000000-adhoc-standalone', { status: 'active', sessionId: 'S1', worktree: liveSibling });
  const removed = seed(main, '2026-10-03T000000-adhoc-standalone', { status: 'active', sessionId: 'S1', worktree: path.join(main, '.claude', 'worktrees', 'gone-wt') });
  const hits = ctxLib.findAdHocRunsBySessionId(main, 'S1');
  assert.deepStrictEqual(hits.map((h) => fs.realpathSync(h.runDir)), [fs.realpathSync(removed)]);
});

test('#2783 G2: a RELATIVE recorded worktree is never provable as "still exists" — the dir stays included', () => {
  const main = gitRepo();
  // A relative path that, resolved against the hook process's OWN cwd
  // (never the recording session's cwd), happens to point at something real
  // — chosen deliberately so the guard under test, not mere non-existence,
  // is what keeps this dir from being wrongly treated as "still live."
  const relativeWorktree = path.relative(process.cwd(), __dirname);
  assert.ok(!path.isAbsolute(relativeWorktree), 'fixture precondition: must be a relative path');
  assert.ok(fs.existsSync(relativeWorktree), 'fixture precondition: must resolve to something real from cwd, proving the guard (not non-existence) is what includes it');
  const dir = seed(main, '2026-10-04T000000-adhoc-standalone', { status: 'active', sessionId: 'S1', worktree: relativeWorktree });
  const hits = ctxLib.findAdHocRunsBySessionId(main, 'S1');
  assert.deepStrictEqual(hits.map((h) => fs.realpathSync(h.runDir)), [fs.realpathSync(dir)]);
});
