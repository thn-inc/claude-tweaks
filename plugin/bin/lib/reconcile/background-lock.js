// bin/lib/reconcile/background-lock.js — a filesystem mutex so at most one
// `reconcile-background` detached pass runs against a given main checkout at
// a time. Without it, several worktree sessions starting within the same
// short window (this project's normal operating pattern) can each read the
// same stale/absent reconcile-background-status.json, each independently
// decide "not fresh," and each spawn an overlapping background pass —
// multiplying gh API load and racing on the same branch deletes/worktree
// removals (review finding). session-start.js's own spawn-decision TTL gate
// is a best-effort optimization to avoid the common case, not a lock — this
// module is the actual mutex, held for the lifetime of one background pass.
'use strict';
const fs = require('fs');
const path = require('path');
const { isPidAlive } = require('../hooks/worktree-reap');

const LOCK_FILENAME = 'reconcile-background.lock';
// Generous relative to budget.js's BACKGROUND_BUDGET_MS (120 s, #4032) — the
// budget is only checked BETWEEN checks, so a pass can overrun it by the length
// of one check; 5 minutes leaves 2.5x headroom for that, so a live, merely-slow
// pass is never mistaken for abandoned, yet a genuinely crashed holder
// (SIGKILL, OOM) doesn't wedge every future pass for this repo indefinitely.
const STALE_LOCK_MS = 5 * 60 * 1000;

function lockPath(root) {
  return path.join(root, '.claude-tweaks', LOCK_FILENAME);
}

function readLock(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// -> the lock path if acquired, or null if another live pass already holds
// it. Fails open on any unexpected I/O error (never blocks a session over
// bookkeeping state, matching this module family's posture elsewhere) — a
// lock this process can't take is treated exactly like "someone else has
// it," never as a reason to throw.
function acquireBackgroundLock(root, { now = Date.now, isAlive = isPidAlive } = {}) {
  const p = lockPath(root);
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch { return null; }
  try {
    fs.writeFileSync(p, JSON.stringify({ pid: process.pid, startedAt: now() }), { encoding: 'utf8', flag: 'wx' });
    return p;
  } catch (e) {
    if (!e || e.code !== 'EEXIST') return null;
  }
  // Held already — reclaim only if the holder is provably gone: a dead pid,
  // or a lock that has outlived any plausible single pass (a crashed holder
  // whose pid was since reused by an unrelated live process).
  const existing = readLock(p);
  const stale = !existing
    || typeof existing.pid !== 'number'
    || !isAlive(existing.pid)
    || (typeof existing.startedAt === 'number' && (now() - existing.startedAt) > STALE_LOCK_MS);
  if (!stale) return null;
  try {
    fs.unlinkSync(p);
    fs.writeFileSync(p, JSON.stringify({ pid: process.pid, startedAt: now() }), { encoding: 'utf8', flag: 'wx' });
    return p;
  } catch {
    // Raced with another reclaimer, or the unlink/create failed for some
    // other reason — treat exactly like "another live pass holds it": skip
    // this pass rather than risk two reclaimers both believing they won.
    return null;
  }
}

function releaseBackgroundLock(p) {
  if (!p) return;
  try { fs.unlinkSync(p); } catch { /* best-effort */ }
}

module.exports = { acquireBackgroundLock, releaseBackgroundLock, lockPath, STALE_LOCK_MS };
