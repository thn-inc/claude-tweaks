'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const {
  acquireBackgroundLock, releaseBackgroundLock, lockPath, STALE_LOCK_MS,
} = require('../../../plugin/bin/lib/reconcile/background-lock');

function tmpRoot() {
  return scratchDir('ct-bg-lock-');
}

test('acquireBackgroundLock: acquires cleanly when no lock exists, writes pid+startedAt', () => {
  const root = tmpRoot();
  const p = acquireBackgroundLock(root, { now: () => 1000 });
  assert.equal(p, lockPath(root));
  const written = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(written.pid, process.pid);
  assert.equal(written.startedAt, 1000);
});

test('acquireBackgroundLock: refuses when a live pid already holds it', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.dirname(lockPath(root)), { recursive: true });
  fs.writeFileSync(lockPath(root), JSON.stringify({ pid: 999999, startedAt: 1000 }));
  const p = acquireBackgroundLock(root, { now: () => 1500, isAlive: () => true });
  assert.equal(p, null);
  // Untouched — still the original holder's record.
  assert.deepEqual(JSON.parse(fs.readFileSync(lockPath(root), 'utf8')), { pid: 999999, startedAt: 1000 });
});

test('acquireBackgroundLock: reclaims when the holder pid is dead', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.dirname(lockPath(root)), { recursive: true });
  fs.writeFileSync(lockPath(root), JSON.stringify({ pid: 999999, startedAt: 1000 }));
  const p = acquireBackgroundLock(root, { now: () => 1500, isAlive: () => false });
  assert.equal(p, lockPath(root));
  const written = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(written.pid, process.pid);
  assert.equal(written.startedAt, 1500);
});

test('acquireBackgroundLock: reclaims a live-pid lock once it has outlived STALE_LOCK_MS (pid reuse guard)', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.dirname(lockPath(root)), { recursive: true });
  fs.writeFileSync(lockPath(root), JSON.stringify({ pid: 999999, startedAt: 0 }));
  // Still "live" (isAlive: true — a reused pid), but old enough to reclaim.
  const p = acquireBackgroundLock(root, { now: () => STALE_LOCK_MS + 1, isAlive: () => true });
  assert.equal(p, lockPath(root));
});

test('acquireBackgroundLock: a live pid within STALE_LOCK_MS is never reclaimed', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.dirname(lockPath(root)), { recursive: true });
  fs.writeFileSync(lockPath(root), JSON.stringify({ pid: 999999, startedAt: 0 }));
  const p = acquireBackgroundLock(root, { now: () => STALE_LOCK_MS - 1, isAlive: () => true });
  assert.equal(p, null);
});

test('releaseBackgroundLock: removes the lock file; a missing/undefined path is a silent no-op', () => {
  const root = tmpRoot();
  const p = acquireBackgroundLock(root, { now: () => 1 });
  assert.ok(fs.existsSync(p));
  releaseBackgroundLock(p);
  assert.ok(!fs.existsSync(p));
  assert.doesNotThrow(() => releaseBackgroundLock(null));
  assert.doesNotThrow(() => releaseBackgroundLock(path.join(root, 'nope.lock')));
});

test('acquireBackgroundLock: a corrupt/unreadable lock file is treated as stale and reclaimed', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.dirname(lockPath(root)), { recursive: true });
  fs.writeFileSync(lockPath(root), 'not json{{{');
  const p = acquireBackgroundLock(root, { now: () => 1 });
  assert.equal(p, lockPath(root));
});
