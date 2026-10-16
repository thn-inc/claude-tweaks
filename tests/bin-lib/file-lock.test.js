'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { acquireLock, releaseLock, withLock } = require('../../plugin/bin/lib/file-lock');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-file-lock-'));
}

test('acquireLock: creates the lock directory and returns a { lockPath, token } handle', () => {
  const dir = tmpDir();
  const lockPath = path.join(dir, '.x.lock');
  const held = acquireLock(lockPath);
  assert.equal(held.lockPath, lockPath);
  assert.equal(typeof held.token, 'string');
  assert.ok(held.token.length > 0);
  assert.ok(fs.existsSync(lockPath));
});

test('acquireLock: parent directory missing -> creates it and still acquires the lock (#1269 follow-up)', () => {
  // A missing parent is the common case on a brand-new store's first-ever write, not an
  // unexpected failure -- treating it as "nothing to lock" let every concurrent caller skip
  // locking entirely on a fresh project (the declined-learning/store-concurrency.test.js
  // regression this follow-up fixes).
  const lockPath = path.join(tmpDir(), 'nonexistent-subdir', '.x.lock');
  const held = acquireLock(lockPath);
  assert.equal(held.lockPath, lockPath);
  assert.ok(fs.existsSync(lockPath));
});

test('releaseLock: removes the lock directory; a no-op on null is safe', () => {
  const dir = tmpDir();
  const lockPath = path.join(dir, '.x.lock');
  const held = acquireLock(lockPath);
  releaseLock(held);
  assert.ok(!fs.existsSync(lockPath));
  assert.doesNotThrow(() => releaseLock(null));
});

test('releaseLock: does not remove a lock reclaimed by another holder out from under this handle (#1192)', () => {
  // The compare-and-delete this test pins: a stale handle whose lock was already reclaimed by
  // someone else (the owner file no longer matches this handle's token) must be a no-op, not a
  // blind rmdir — otherwise releasing a stale handle would destroy the new, legitimately active
  // holder's lock.
  const dir = tmpDir();
  const lockPath = path.join(dir, '.x.lock');
  const staleHeld = acquireLock(lockPath);
  releaseLock(staleHeld); // release it for real first, then simulate a second, independent holder
  const newHeld = acquireLock(lockPath);
  assert.notEqual(newHeld.token, staleHeld.token);
  releaseLock(staleHeld); // stale handle, wrong token for the CURRENT lock dir's owner file
  assert.ok(fs.existsSync(lockPath), 'the new holder\'s lock must survive a stale release');
  releaseLock(newHeld);
  assert.ok(!fs.existsSync(lockPath));
});

test('acquireLock: never reclaims a lock whose owner pid is still alive, however old the lock dir is (#1192)', () => {
  // The false-positive this test pins: the old mtime-only staleness check treated ANY lock dir
  // older than LOCK_STALE_MS as abandoned, even when its holder was simply slow (disk/scheduler
  // jitter), not crashed -- letting a second acquirer's critical section run concurrently with
  // the first's still-in-progress one (the exact unsynchronized-read-modify-write shape this
  // lock exists to prevent -- reproduced via a real cross-process timing harness while
  // developing this fix). Backdating the lock dir's mtime past the stale threshold, while its
  // owner file still names this (very much alive) test process's own pid, must NOT be reclaimed.
  const dir = tmpDir();
  const lockPath = path.join(dir, '.x.lock');
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, '.owner'), `${process.pid}-simulated-live-holder`);
  const oldTime = new Date(Date.now() - 10000); // 10s old -- comfortably past the 5s stale threshold
  fs.utimesSync(lockPath, oldTime, oldTime);

  const prevWait = process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
  process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = '50'; // short budget -- this call must fail open, not steal
  try {
    const held = acquireLock(lockPath);
    assert.equal(held, null, 'a live holder\'s lock must never be reclaimed, no matter its age');
  } finally {
    if (prevWait === undefined) delete process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
    else process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = prevWait;
  }

  // The original lock dir and owner file must be untouched -- not removed, not recreated.
  assert.ok(fs.existsSync(lockPath));
  assert.equal(fs.readFileSync(path.join(lockPath, '.owner'), 'utf8'), `${process.pid}-simulated-live-holder`);
});

test('acquireLock: reclaims a lock whose owner pid is confirmed dead, regardless of age (crash recovery)', () => {
  const dir = tmpDir();
  const lockPath = path.join(dir, '.x.lock');
  fs.mkdirSync(lockPath);
  // A pid that (almost certainly) does not exist: spawn a short-lived child, capture its pid,
  // and use it only after confirming it has exited.
  const { spawnSync } = require('child_process');
  const probe = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  const deadPid = probe.pid;
  fs.writeFileSync(path.join(lockPath, '.owner'), `${deadPid}-simulated-crashed-holder`);
  // Fresh mtime (simulating a crash that happened moments ago, well under LOCK_STALE_MS) --
  // liveness alone, not age, must drive the reclaim here.

  const held = acquireLock(lockPath);
  assert.notEqual(held, null, 'a lock whose holder pid is confirmed dead must be reclaimed even when fresh');
  assert.equal(held.lockPath, lockPath);
  releaseLock(held);
});

test('withLock: runs fn while holding the lock, releases it afterward even on throw', () => {
  const dir = tmpDir();
  const lockPath = path.join(dir, '.x.lock');

  const result = withLock(lockPath, () => 'ok');
  assert.equal(result, 'ok');
  assert.ok(!fs.existsSync(lockPath), 'released after a normal return');

  assert.throws(() => withLock(lockPath, () => { throw new Error('boom'); }), /boom/);
  assert.ok(!fs.existsSync(lockPath), 'released even when fn throws');
});

test('withLock: a second acquirer waits for the first to release, under real cross-process concurrency (no lost updates)', async () => {
  // Reproduces the shape declined-learning/store.js's recordDecline relies on: many real OS
  // processes racing a read-modify-write against the same JSON file, each appending its own key.
  // Without the lock, one writer's stale-snapshot write would silently drop another's entry.
  const dir = tmpDir();
  const lockPath = path.join(dir, '.x.lock');
  const dataPath = path.join(dir, 'data.json');
  fs.writeFileSync(dataPath, '{}');

  const WORKERS = 8;
  const fileLockModule = path.join(__dirname, '..', '..', 'plugin', 'bin', 'lib', 'file-lock.js');
  const workerScript = (i) => `
    const fs = require('fs');
    const { withLock } = require(${JSON.stringify(fileLockModule)});
    withLock(${JSON.stringify(lockPath)}, () => {
      const current = JSON.parse(fs.readFileSync(${JSON.stringify(dataPath)}, 'utf8'));
      current['w${i}'] = true;
      fs.writeFileSync(${JSON.stringify(dataPath)}, JSON.stringify(current));
    });
  `;

  const procs = [];
  for (let i = 0; i < WORKERS; i++) {
    procs.push(new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['-e', workerScript(i)], {
        env: { ...process.env, CLAUDE_TWEAKS_LOCK_WAIT_MS: '60000' },
      });
      let stderr = '';
      p.stderr.on('data', (d) => { stderr += d; });
      // 'close', not 'exit' — 'exit' can fire before stdio streams finish delivering
      // buffered data (Node docs: only 'close' guarantees that), which can truncate a
      // failing worker's stderr exactly when it's needed for diagnosis.
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${i} exited ${code}: ${stderr}`))));
      p.on('error', reject);
    }));
  }
  await Promise.all(procs);

  const final = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  for (let i = 0; i < WORKERS; i++) {
    assert.equal(final[`w${i}`], true, `worker ${i}'s key must not be lost to a concurrent writer's stale snapshot`);
  }
});
