'use strict';

// spawnBackgroundIfStale (#4032): the spawn decision + detached spawn shared by
// SessionStart and the unscoped `hooks.js reconcile` CLI. `child_process.spawn`
// is always stubbed — no test starts a real background reconcile.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { spawnBackgroundIfStale, STATUS_FILENAME } = require('../../../plugin/bin/lib/reconcile/background-spawn');

function rootWithStatus(status) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bgspawn-'));
  if (status) {
    fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude-tweaks', STATUS_FILENAME), JSON.stringify(status));
  }
  return root;
}

function stubSpawn(impl) {
  const original = cp.spawn;
  const calls = [];
  cp.spawn = (...args) => { calls.push(args); return impl(...args); };
  return { calls, restore: () => { cp.spawn = original; } };
}

function fakeChild() {
  const listeners = [];
  const child = {
    unrefCalled: false,
    on(event, fn) { listeners.push([event, fn]); return child; },
    unref() { child.unrefCalled = true; },
    listeners,
  };
  return child;
}

test('fresh status suppresses the spawn', () => {
  const root = rootWithStatus({ completedAt: Date.now() });
  const stub = stubSpawn(() => { throw new Error('must not spawn'); });
  try {
    assert.deepEqual(spawnBackgroundIfStale({ root, cwd: root }), { spawned: false, reason: 'fresh' });
    assert.equal(stub.calls.length, 0);
  } finally { stub.restore(); }
});

test('stale status spawns detached + windowsHide with an error listener', () => {
  const root = rootWithStatus({ completedAt: 1 });
  const child = fakeChild();
  const stub = stubSpawn(() => child);
  try {
    const r = spawnBackgroundIfStale({ root, cwd: root, sessionId: 'sess-123' });
    assert.deepEqual(r, { spawned: true, reason: 'spawned' });
    assert.equal(stub.calls.length, 1);
    const [cmd, argv, opts] = stub.calls[0];
    assert.equal(cmd, process.execPath);
    assert.equal(argv.length, 2);
    assert.ok(argv[0].endsWith(path.join('bin', 'hooks.js')), argv[0]);
    assert.equal(argv[1], 'reconcile-background');
    assert.equal(opts.detached, true);
    assert.equal(opts.windowsHide, true);
    assert.equal(opts.stdio, 'ignore');
    assert.equal(opts.cwd, root);
    assert.equal(opts.env.CLAUDE_TWEAKS_SESSION_ID, 'sess-123');
    const errorListeners = child.listeners.filter(([event]) => event === 'error');
    assert.equal(errorListeners.length, 1);
    assert.doesNotThrow(() => errorListeners[0][1](new Error('EAGAIN')));
    assert.equal(child.unrefCalled, true);
  } finally { stub.restore(); }
});

test('a missing or malformed status file counts as stale; no session id leaves the env untouched', () => {
  const root = rootWithStatus(null);
  const stub = stubSpawn(() => fakeChild());
  try {
    assert.equal(spawnBackgroundIfStale({ root, cwd: root }).reason, 'spawned');
    assert.equal(stub.calls[0][2].env, process.env);
    fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude-tweaks', STATUS_FILENAME), '{not json');
    assert.equal(spawnBackgroundIfStale({ root, cwd: root }).reason, 'spawned');
  } finally { stub.restore(); }
});

test('an explicit now past the TTL makes a once-fresh status stale', () => {
  const completedAt = Date.now();
  const root = rootWithStatus({ completedAt });
  const stub = stubSpawn(() => fakeChild());
  try {
    assert.equal(spawnBackgroundIfStale({ root, cwd: root, now: completedAt }).reason, 'fresh');
    assert.equal(spawnBackgroundIfStale({ root, cwd: root, now: completedAt + 24 * 60 * 60 * 1000 }).reason, 'spawned');
  } finally { stub.restore(); }
});

test('a throwing spawn reports spawn-failed', () => {
  const root = rootWithStatus({ completedAt: 1 });
  const stub = stubSpawn(() => { throw new Error('EAGAIN'); });
  try {
    assert.deepEqual(spawnBackgroundIfStale({ root, cwd: root }), { spawned: false, reason: 'spawn-failed' });
  } finally { stub.restore(); }
});

test('no root reports no-root without spawning', () => {
  const stub = stubSpawn(() => { throw new Error('must not spawn'); });
  try {
    assert.deepEqual(spawnBackgroundIfStale({ root: null, cwd: os.tmpdir() }), { spawned: false, reason: 'no-root' });
    assert.equal(stub.calls.length, 0);
  } finally { stub.restore(); }
});
