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
