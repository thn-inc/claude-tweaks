// bin/lib/git-retry.js — bounded retry for a transient `git commit` failure
// caused by index-lock contention (#2346). In a multi-agent setting (parallel
// dispatch, worktrees, hooks running git in the background against the same
// checkout) a sibling's own git call — or a PostToolUse hook — can hold
// `.git/index.lock` for the fraction of a second another commit call needs
// it too. Every such collision observed in practice (see #2346's Current
// State) succeeded on a plain retry a couple of seconds later; nothing in
// the plugin's own commit call sites provided one before this file.
//
// Same shape as `bin/lib/feedback/file-feedback.js`'s `withTransientRetry`:
// a higher-order function wrapping a throwing, execFileSync-shaped runner
// (returns the runner's success value unchanged; throws an Error — with a
// `.stderr` string when the runner is execFileSync-shaped — on failure), an
// options object carrying an injectable `sleep` so tests never actually
// wait. Diverges deliberately on what it retries: `withTransientRetry` keys
// on a 5xx/timeout `gh` signature; this keys on git's own index-lock wording
// instead, and is bounded far higher (attempts, not maxRetries) since a
// same-checkout sibling's lock is expected to clear in seconds, not the
// single-retry network-blip case that helper targets.
'use strict';

// Matches git's own wording for the two known index-lock collision shapes:
// `fatal: Unable to create '<repo>/.git/index.lock': File exists.` and
// `fatal: … another git process seems to be running in this repository…`.
// Deliberately narrow — a broad transient-error match would risk silently
// retrying (and masking, behind a multi-attempt delay) a genuine, unrelated
// git failure.
const INDEX_LOCK_RE = /index\.lock|another git process seems to be running/i;

// Same shape as file-feedback.js's own errorText — a runner may throw a
// non-Error (string, object, undefined); never let the failure reason come
// back empty, and inspect stderr/stdout too since execFileSync populates
// those on the thrown error, not just `.message`.
function errorText(err) {
  const parts = [err && err.message, err && err.stderr, err && err.stdout].filter(Boolean).map(String);
  return parts.length ? parts.join(' ') : String(err);
}

function isIndexLockFailure(err) {
  return INDEX_LOCK_RE.test(errorText(err));
}

// Same synchronous-sleep trick as bin/lib/file-lock.js's sleepSync and
// file-feedback.js's own copy.
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best-effort */ }
}

// Wrap `gitRunner` so an index-lock collision is retried up to `attempts`
// times total (default 15), waiting `waitMs` between attempts (default
// 2000ms — ~15 attempts * 2s = 30s of headroom, well past the sub-second
// hold times observed in practice), before giving up and rethrowing the
// original error unchanged. Any non-index-lock failure is rethrown
// immediately on the first attempt — no retry, no delay. Never unlinks
// (or otherwise touches) the lock file itself: the lock always clears on
// its own once its holder's git process exits, and forcing it open risks
// corrupting whichever commit is actually in flight.
function withIndexLockRetry(gitRunner, { attempts = 15, waitMs = 2000, sleep = sleepSync } = {}) {
  return function retryingGit(...args) {
    let lastErr;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return gitRunner(...args);
      } catch (err) {
        if (!isIndexLockFailure(err)) throw err;
        lastErr = err;
        if (attempt < attempts - 1) sleep(waitMs);
      }
    }
    throw lastErr;
  };
}

module.exports = { withIndexLockRetry, isIndexLockFailure };
