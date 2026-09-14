// bin/lib/model-profiles/session-failures.js
//
// Pure(ish) filesystem helpers for the session-scoped model-failure
// blacklist (#763) — the code twin of
// skills/_shared/subagent-dispatch-core.md's Model Selection section's
// "record-failure" note. Mirrors bin/lib/issues/record-snapshot.js's
// session-file convention exactly: one file per session under os.tmpdir(),
// keyed by CLAUDE_CODE_SESSION_ID. No network; resolve-profile.js owns
// when this is read/written, same division of labor as record-snapshot.js
// and its `gh`-calling consumers.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');

// A session id is required for the blacklist to mean anything — without
// one, concurrent unrelated invocations (no session context at all, e.g. a
// bare `node bin/resolve-profile.js standard` outside any Claude Code
// session) would silently share (and race on) the same file. An
// absent/blank id resolves to null, which every function below treats as
// "nothing recorded, nothing to record" rather than an error.
function resolveSessionId(sessionId) {
  return sessionId && String(sessionId).trim() ? String(sessionId).trim() : null;
}

function failurePath(sessionId) {
  const id = resolveSessionId(sessionId);
  if (!id) return null;
  return path.join(os.tmpdir(), `ct-model-failures-${id}.json`);
}

// -> Set<string> of model names that have failed with a credit/usage
// exhaustion error this session. Any read failure (missing file, malformed
// JSON) degrades to an empty set — a corrupt or absent blacklist must
// never block a resolution, only fail to protect one.
function readFailedModels(sessionId) {
  const p = failurePath(sessionId);
  if (!p) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return new Set(Array.isArray(data) ? data : []);
  } catch {
    return new Set();
  }
}

// #841 item 1: a small mkdir-based mutual-exclusion lock around
// recordFailure's read-modify-write below. fs.mkdirSync is atomic on every
// platform Node targets — "did I create this directory" is a genuine
// test-and-set — unlike the read-then-add-then-write sequence it guards,
// which is not atomic on its own: two concurrent recordFailure calls for
// two *different* models can both read the same starting set, each add
// their own model, then both write, and the second rename wins — the
// loser's model is silently dropped (the lost-update variant; the separate
// torn-read variant is already closed by the tmp-file+rename below).
//
// Best-effort: if the lock cannot be acquired within `lockTimeoutMs`, the
// write proceeds without it rather than blocking or throwing —
// recordFailure must never be the reason a dispatch hangs or fails. A
// dropped write under contention degrades to the pre-#841 best-effort
// posture (silent loss of one model, never data corruption), not a new
// failure mode.
const LOCK_TIMEOUT_MS = 2000;
const LOCK_POLL_MS = 20;

function acquireLock(lockDir, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') return false; // unexpected error — proceed unlocked
      if (Date.now() >= deadline) return false; // timed out — proceed unlocked (best-effort)
      // Node has no synchronous sleep primitive; Atomics.wait on a private
      // SharedArrayBuffer blocks this thread for pollMs without the busy-spin
      // a tight empty loop would cost.
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
      } catch {
        // Atomics.wait unavailable (rare) — fall through to an immediate retry.
      }
    }
  }
}

function releaseLock(lockDir) {
  try { fs.rmdirSync(lockDir); } catch { /* already gone, or never acquired */ }
}

// Appends `model` to the session's failure set (idempotent — recording the
// same model twice does not duplicate it). A no-op when no session id is
// available: there is nowhere safe to write a shared file, and the CLI
// layer (Task 3) is what decides whether that no-op should be reported to
// the caller as a failure.
//
// Writes via bin/lib/atomic-write.js's writeFileAtomic (a pid-suffixed
// same-directory temp file + rename) rather than a direct writeFileSync:
// rename is atomic on POSIX, so a concurrent readFailedModels call (a
// sibling Task dispatch's own read, per this repo's parallel fan-out
// dispatch pattern) always sees either the old complete file or the new
// complete file, never a torn/truncated one mid-write — and a failed write
// or rename is now cleaned up (best-effort tmp-file unlink) before
// rethrowing, rather than leaving a stray tmp file behind. The mkdir lock
// above additionally serializes the read-modify-write against a concurrent
// recordFailure, closing the lost-update race the rename alone did not.
//
// `opts.lockTimeoutMs`/`opts.lockPollMs` override the production defaults —
// exposed for tests to prove the timeout-degrade path without a real
// multi-second wait; production callers omit both.
function recordFailure(sessionId, model, opts = {}) {
  const p = failurePath(sessionId);
  if (!p) return;
  const lockDir = `${p}.lock`;
  const locked = acquireLock(lockDir, opts.lockTimeoutMs ?? LOCK_TIMEOUT_MS, opts.lockPollMs ?? LOCK_POLL_MS);
  try {
    const current = readFailedModels(sessionId);
    current.add(model);
    writeFileAtomic(p, JSON.stringify([...current]));
  } finally {
    if (locked) releaseLock(lockDir);
  }
}

// #841 item 3: the one recovery path for this blacklist. Credit exhaustion
// is normally a usage window, not permanent — a session degraded early in a
// long-running window otherwise has no documented way to clear it before
// the window naturally rolls over. Deletes the session's failure file,
// tolerating it already being absent. Mirrors
// bin/lib/issues/record-snapshot.js's invalidateSnapshot() shape; see that
// file's own header for the sibling this was compared against.
function invalidateFailures(sessionId) {
  const p = failurePath(sessionId);
  if (!p) return;
  try {
    fs.unlinkSync(p);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = {
  failurePath, readFailedModels, recordFailure, invalidateFailures, acquireLock, releaseLock,
};
