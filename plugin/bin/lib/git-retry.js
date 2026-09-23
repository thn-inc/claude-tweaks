// bin/lib/git-retry.js — a shared bounded retry for git index.lock
// contention, wrapping a git-committing runner the same way
// bin/lib/feedback/file-feedback.js's withTransientRetry wraps a `gh`
// runner on a transient-error signature — same shape, keyed on a different
// error text.
//
// In one seven-spec multi-record run, eight commits failed with
// `fatal: Unable to create '<repo>/.git/index.lock': File exists`. The lock
// holder was a sibling agent's git call or a PostToolUse hook in the same
// checkout, never a stale process — every one of them succeeded on a retry
// a couple of seconds later. Nothing in the plugin's own commit call sites
// (bin/lib/reconcile/archive-merged.js, bin/lib/release/run.js,
// bin/release-local.js) provided that retry; a standing operator-side rule
// ("retry, never `rm` the lock") is what this file catches the code up to.
//
// Two git-runner conventions coexist in this codebase, and this helper
// supports both without the call site needing to know which one it has:
//   - throws on failure (raw `execFileSync` wrappers — release/run.js's and
//     release-local.js's `deps.git`);
//   - returns `{ stdout, failure, stderr }` without throwing
//     (bin/lib/hooks/git-exec.js's `runGit`, archive-merged.js's commit call).
'use strict';

// Same synchronous-sleep trick as bin/lib/file-lock.js's sleepSync and
// bin/lib/feedback/file-feedback.js's sleepSync.
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best-effort */ }
}

// Matches only a git index-lock collision — deliberately narrow. A broader
// transient-error match would risk silently retrying a genuine, non-lock
// git failure and masking it behind a multi-attempt delay (the exact
// mistake this file's own doc comment above warns against).
const INDEX_LOCK_RE = /unable to create ['"][^'"]*index\.lock['"]|another git process seems to be running/i;

// Same shape as bin/lib/feedback/file-feedback.js's errorText — a thrown
// value or a `{ failure, stderr }` result object may carry the relevant text
// on different keys; never let the check come back against an empty string.
function errorText(errOrResult) {
  const parts = [errOrResult && errOrResult.message, errOrResult && errOrResult.stderr, errOrResult && errOrResult.stdout]
    .filter(Boolean)
    .map(String);
  return parts.length ? parts.join(' ') : String(errOrResult);
}

function isIndexLockFailure(errOrResult) {
  return INDEX_LOCK_RE.test(errorText(errOrResult));
}

// Wrap a git-committing runner so an index.lock collision is retried, bounded,
// before giving up — this function never unlinks a lock file itself; retrying
// is the whole mechanism. `sleep` is injectable so tests never actually wait.
// The returned function forwards every argument to `gitRunner` unchanged, so
// it drops in at a call site regardless of that runner's own arity —
// `runGit(args, cwd)` or `deps.git(args)` alike.
function withIndexLockRetry(gitRunner, { attempts = 15, waitMs = 2000, sleep = sleepSync } = {}) {
  return function retryingGitRunner(...args) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let threw = false;
      let caught;
      let result;
      try {
        result = gitRunner(...args);
      } catch (err) {
        threw = true;
        caught = err;
      }
      const failed = threw || !!(result && result.failure);
      if (!failed) return result;
      const lockContention = isIndexLockFailure(threw ? caught : result);
      const isLastAttempt = attempt === attempts;
      if (!lockContention || isLastAttempt) {
        if (threw) throw caught;
        return result;
      }
      sleep(waitMs);
    }
    // Unreachable — the loop above always returns or throws by the last
    // attempt — but keeps the function's control flow explicit rather than
    // relying on that invariant silently.
    return undefined;
  };
}

module.exports = { withIndexLockRetry, isIndexLockFailure, INDEX_LOCK_RE };
