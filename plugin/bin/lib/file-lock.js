// plugin/bin/lib/file-lock.js
// Directory-based mutex generalized from bin/lib/hooks/context.js's
// acquireRunStateLock/releaseRunStateLock (there, hardcoded to a
// runDir-scoped `.run-state.lock`) — same mechanism (fs.mkdirSync is atomic
// on every platform Node supports: EEXIST if another writer already holds
// it), parameterized by an arbitrary lock path so a non-run-dir store
// (declined-learning/store.js) can guard its own read-modify-write without
// hand-rolling a second copy. context.js keeps its own copy unchanged — this
// module is for new callers, not a refactor of that one.
'use strict';
const fs = require('fs');
const path = require('path');

// Overridable via CLAUDE_TWEAKS_LOCK_WAIT_MS — same test-only knob
// context.js's resolveLockWaitMs documents. One production caller now sets
// it too: plugin/bin/lib/docs-health/commit-ref.js's deepenShallowClone,
// briefly, around a single acquireLock call, restoring the prior value
// (or absence) immediately after (#2988 whole-branch review finding).
function resolveLockWaitMs() {
  const raw = process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : 500;
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best-effort */ }
}

const LOCK_POLL_MS = 10;
// Fallback only (see acquireLock's reclaim branch below) — the primary
// abandonment signal is process liveness, not age. A lock dir older than
// this with NO readable owner file (a foreign/corrupt lock, or the sub-ms
// window between mkdirSync and the owner-file write) is reclaimed on age
// alone, since there is no PID to check.
const LOCK_STALE_MS = 5000;

function ownerFilePath(lockPath) {
  return path.join(lockPath, '.owner');
}

// pid -> true if a process with that pid still exists (same host — this is
// a local mkdir-based lock, never a distributed one). `process.kill(pid, 0)`
// sends no signal, it only probes existence; EPERM means the process exists
// but is owned by someone else, which still counts as alive.
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return Boolean(e && e.code === 'EPERM');
  }
}

// lockPath -> the holder's pid recorded in its owner file, or null when the
// file is missing/unreadable/malformed (fs.readFileSync failing counts the
// same as a garbled token — there is nothing here to trust either way).
function readOwnerPid(lockPath) {
  try {
    const raw = fs.readFileSync(ownerFilePath(lockPath), 'utf8');
    const pid = Number(String(raw).split('-')[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

// Acquires a mkdir-based lock at `lockPath`, waiting up to LOCK_WAIT_MS.
// Returns a { lockPath, token } handle on success, null on timeout — the
// caller proceeds unlocked (this project's posture: never break a caller
// over bookkeeping state; a missed lock just reopens the pre-existing race
// window instead of hanging).
//
// Reclaiming an existing lock as abandoned is liveness-based, not purely
// age-based (review finding, #1192): the previous mtime-only heuristic
// treated any lock dir older than LOCK_STALE_MS as abandoned, but a live
// holder whose critical section simply took longer than that (disk/process
// scheduling jitter under load) is not abandoned — reclaiming it let a
// second acquirer's critical section run concurrently with the first's
// still-in-progress one, the exact unsynchronized-read-modify-write shape
// this lock exists to prevent. Age is now only the fallback for a lock
// whose owner pid can't be read at all (see readOwnerPid above).
function acquireLock(lockPath) {
  const deadline = Date.now() + resolveLockWaitMs();
  const parentDir = path.dirname(lockPath);
  const token = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      try { fs.writeFileSync(ownerFilePath(lockPath), token); } catch { /* best-effort — see readOwnerPid's null fallback */ }
      return { lockPath, token };
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        // The lock's own parent directory doesn't exist yet -- the common
        // bootstrap race on a fresh project's first-ever concurrent write
        // (nothing has run the store's own mkdirSync yet). Create it and
        // retry the lock attempt, rather than treating this as "nothing to
        // lock" and letting every concurrent caller skip locking entirely
        // (#1269 follow-up: this was silently unlocking every worker racing
        // a brand-new store).
        try { fs.mkdirSync(parentDir, { recursive: true }); } catch { /* races with a sibling creator are fine */ }
        if (Date.now() >= deadline) return null;
        continue;
      }
      if (!e || e.code !== 'EEXIST') return null; // some other mkdir failure — nothing to lock
      let reclaim = false;
      const ownerPid = readOwnerPid(lockPath);
      if (ownerPid !== null) {
        reclaim = !isAlive(ownerPid); // never steal a lock whose holder is still running, however long it's held it
      } else {
        try {
          const age = Date.now() - fs.statSync(lockPath).mtimeMs;
          reclaim = age > LOCK_STALE_MS;
        } catch { /* raced with another reclaimer, or the lock is already gone — just retry below */ }
      }
      if (reclaim) {
        try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch { /* raced with another reclaimer */ }
        continue;
      }
      if (Date.now() >= deadline) return null;
      sleepSync(LOCK_POLL_MS);
    }
  }
}

// Releases a lock acquired via acquireLock. `held` is that call's returned
// handle ({ lockPath, token }) — a compare-and-delete against the owner
// file's current content, not a blind rmdir: if this handle's token no
// longer matches (another acquirer already reclaimed this lock as
// abandoned and is now the true holder), this call must NOT remove the
// directory — doing so would destroy that new holder's still-active lock
// out from under it, reopening the exact race the liveness check above
// exists to close.
function releaseLock(held) {
  if (!held) return;
  const { lockPath, token } = held;
  try {
    let owner = null;
    try { owner = fs.readFileSync(ownerFilePath(lockPath), 'utf8'); } catch { /* gone or unreadable — nothing to compare, skip removal */ }
    if (owner === token) fs.rmSync(lockPath, { recursive: true, force: true });
  } catch { /* best-effort */ }
}

// Runs `fn` — synchronous, or returning a Promise, either way — holding the
// lock at `lockPath`. Default posture is fail-open, matching acquireLock's
// own contract: `fn` still runs even when the lock couldn't be acquired in
// time. `opts.failClosed: true` overrides that for a caller whose own
// invariant a missed lock would violate (e.g. "no two racing writers may
// both proceed") — it throws a `LOCK_TIMEOUT`-coded error instead of running
// `fn` unlocked. When `fn`'s return value is thenable, the lock is held
// until that promise settles (release happens in `.then`/`.catch`, not
// synchronously after the call) — a synchronous `finally` would otherwise
// release the lock before an async `fn`'s own work (e.g. a probe-then-write
// sequence) has actually finished, reopening the exact race the lock exists
// to close.
function withLock(lockPath, fn, opts = {}) {
  const { failClosed = false } = opts;
  const held = acquireLock(lockPath);
  if (held === null && failClosed) {
    const err = new Error(`could not acquire lock within the configured wait: ${lockPath}`);
    err.code = 'LOCK_TIMEOUT';
    throw err;
  }
  let result;
  try {
    result = fn();
  } catch (err) {
    releaseLock(held);
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result.then(
      (value) => { releaseLock(held); return value; },
      (err) => { releaseLock(held); throw err; },
    );
  }
  releaseLock(held);
  return result;
}

module.exports = { acquireLock, releaseLock, withLock };
