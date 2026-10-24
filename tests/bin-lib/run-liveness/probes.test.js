'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { DEFAULT_PROBES } = require('../../../plugin/bin/lib/run-liveness/probes');
const { lastCommitMs } = require('../../../plugin/bin/lib/hooks/resume-freshness');

function git(args) {
  return execFileSync('git', args, { windowsHide: true, encoding: 'utf8', timeout: 30000 });
}
function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}
function emptyRepo() {
  const dir = tmp('ct-probes-repo-');
  git(['-C', dir, 'init', '-q']);
  return dir;
}
function commit(dir) {
  git(['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--allow-empty', '-q', '-m', 'init']);
}
function repoWithLinkedWorktree() {
  const main = emptyRepo();
  commit(main);
  const wt = path.join(tmp('ct-probes-wt-'), 'wt');
  git(['-C', main, 'worktree', 'add', '-q', wt, '-b', 'probes-branch']);
  return { main, wt: fs.realpathSync(wt) };
}

test('lastCommitMs equals %ct * 1000 on a repo with one commit', () => {
  const dir = emptyRepo();
  commit(dir);
  const ct = Number(git(['-C', dir, 'log', '-1', '--format=%ct']).trim());
  assert.strictEqual(lastCommitMs(dir), ct * 1000);
});

test('lastCommitMs is null on a repo with no commits', () => {
  assert.strictEqual(lastCommitMs(emptyRepo()), null);
});

test('lastCommitMs throws on a non-repo directory', () => {
  assert.throws(() => lastCommitMs(tmp('ct-probes-norepo-')));
});

// A damaged repo that HAS commits must read as a probe error, never as a clean
// "no commits" (fix round 1).
function branchRefFile(dir) {
  return path.join(dir, '.git', git(['-C', dir, 'symbolic-ref', 'HEAD']).trim());
}

test('lastCommitMs throws on a repo with commits and a corrupted branch ref', () => {
  const dir = emptyRepo();
  commit(dir);
  fs.writeFileSync(branchRefFile(dir), 'garbage\n');
  assert.throws(() => lastCommitMs(dir));
});

test('lastCommitMs throws on a repo with commits and its loose objects deleted', () => {
  const dir = emptyRepo();
  commit(dir);
  fs.rmSync(path.join(dir, '.git', 'objects'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.git', 'objects'));
  assert.throws(() => lastCommitMs(dir));
});

test('lastCommitMs throws on a repo with commits and a garbage HEAD', () => {
  const dir = emptyRepo();
  commit(dir);
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'garbage\n');
  assert.throws(() => lastCommitMs(dir));
});

test('lastCommitMs throws on a repo with commits whose branch ref file was deleted (reflog survives)', () => {
  const dir = emptyRepo();
  commit(dir);
  fs.rmSync(branchRefFile(dir));
  assert.throws(() => lastCommitMs(dir));
});

test('lastCommitMs is null on an orphan branch of a repo that has commits elsewhere', () => {
  const dir = emptyRepo();
  commit(dir);
  git(['-C', dir, 'checkout', '-q', '--orphan', 'orph']);
  assert.strictEqual(lastCommitMs(dir), null);
});

test('lockInUse is false for an unlocked linked worktree', () => {
  const { wt } = repoWithLinkedWorktree();
  assert.strictEqual(DEFAULT_PROBES.lockInUse(wt), false);
});

test('lockInUse is true when the worktree is locked by a live pid', () => {
  const { main, wt } = repoWithLinkedWorktree();
  git(['-C', main, 'worktree', 'lock', '--reason', `claude (pid ${process.pid})`, wt]);
  assert.strictEqual(DEFAULT_PROBES.lockInUse(wt), true);
});

test('lockInUse is false when the lock pid is dead (orphaned)', () => {
  const { main, wt } = repoWithLinkedWorktree();
  git(['-C', main, 'worktree', 'lock', '--reason', 'claude (pid 2147483646)', wt]);
  assert.strictEqual(DEFAULT_PROBES.lockInUse(wt), false);
});

test('lockInUse throws when the lock reason carries no pid (unknown)', () => {
  const { main, wt } = repoWithLinkedWorktree();
  git(['-C', main, 'worktree', 'lock', '--reason', 'no pid here', wt]);
  assert.throws(() => DEFAULT_PROBES.lockInUse(wt));
});

test('lockInUse throws for an existing directory git does not list as a worktree, instead of reading it as free', () => {
  const { main } = repoWithLinkedWorktree();
  const sub = path.join(main, 'not-a-worktree');
  fs.mkdirSync(sub);
  assert.throws(() => DEFAULT_PROBES.lockInUse(sub), /not listed/);
});

test('lockInUse throws on a non-repo path', () => {
  assert.throws(() => DEFAULT_PROBES.lockInUse(tmp('ct-probes-norepo-')));
});

function runDirWith(lines) {
  const dir = tmp('ct-probes-run-');
  if (lines !== null) fs.writeFileSync(path.join(dir, 'events.jsonl'), lines.join('\n') + (lines.length ? '\n' : ''));
  return dir;
}
const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-01T11:00:00.000Z';
const T3 = '2026-10-01T12:00:00.000Z';

test('ownEventAt ignores fallback-attributed lines for both fields', () => {
  const dir = runDirWith([
    JSON.stringify({ type: 'skill_invoked', ts: T1, attribution: 'owner' }),
    JSON.stringify({ type: 'session-end', ts: T2, attribution: 'owner' }),
    JSON.stringify({ type: 'session-end', ts: T3, attribution: 'fallback' }),
  ]);
  assert.deepStrictEqual(DEFAULT_PROBES.ownEventAt(dir), { lastOwnMs: Date.parse(T2), lastSessionEndMs: Date.parse(T2) });
});

test('ownEventAt: lastSessionEndMs is null when only non-session-end events exist', () => {
  const dir = runDirWith([JSON.stringify({ type: 'skill_invoked', ts: T1 })]);
  assert.deepStrictEqual(DEFAULT_PROBES.ownEventAt(dir), { lastOwnMs: Date.parse(T1), lastSessionEndMs: null });
});

test('ownEventAt with an owner session id counts only that session\'s session-end events', () => {
  const dir = runDirWith([
    JSON.stringify({ type: 'session-end', ts: T1, sessionId: 'A', attribution: 'owner' }),
    JSON.stringify({ type: 'session-end', ts: T3, sessionId: 'B', attribution: 'owner' }),
    JSON.stringify({ type: 'session-end', ts: T2, attribution: 'owner' }),
  ]);
  assert.deepStrictEqual(DEFAULT_PROBES.ownEventAt(dir, 'A'), { lastOwnMs: Date.parse(T3), lastSessionEndMs: Date.parse(T1) });
  assert.deepStrictEqual(DEFAULT_PROBES.ownEventAt(dir, 'C'), { lastOwnMs: Date.parse(T3), lastSessionEndMs: null });
  assert.deepStrictEqual(DEFAULT_PROBES.ownEventAt(dir, null), { lastOwnMs: Date.parse(T3), lastSessionEndMs: null });
});

test('ownEventAt without an owner session id keeps counting every non-fallback session-end event', () => {
  const dir = runDirWith([
    JSON.stringify({ type: 'session-end', ts: T1, sessionId: 'A' }),
    JSON.stringify({ type: 'session-end', ts: T3, sessionId: 'B' }),
  ]);
  assert.deepStrictEqual(DEFAULT_PROBES.ownEventAt(dir), { lastOwnMs: Date.parse(T3), lastSessionEndMs: Date.parse(T3) });
  assert.deepStrictEqual(DEFAULT_PROBES.ownEventAt(dir, undefined), { lastOwnMs: Date.parse(T3), lastSessionEndMs: Date.parse(T3) });
});

test('ownEventAt throws when events.jsonl is absent', () => {
  assert.throws(() => DEFAULT_PROBES.ownEventAt(runDirWith(null)));
});

test('ownEventAt over an empty events.jsonl is all null', () => {
  assert.deepStrictEqual(DEFAULT_PROBES.ownEventAt(runDirWith([])), { lastOwnMs: null, lastSessionEndMs: null });
});

test('DEFAULT_PROBES has exactly the six keys and delegates the simple ones', () => {
  assert.deepStrictEqual(Object.keys(DEFAULT_PROBES).sort(),
    ['hostname', 'lastCommitAt', 'lockInUse', 'ownEventAt', 'pidAlive', 'pidStartTime']);
  assert.strictEqual(DEFAULT_PROBES.hostname(), os.hostname());
  assert.strictEqual(DEFAULT_PROBES.pidAlive(process.pid), true);
  assert.strictEqual(DEFAULT_PROBES.pidAlive(2147483646), false);
});
