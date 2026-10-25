// bin/lib/reconcile/budget.js — an overall wall-clock ceiling for one
// reconcile() pass, so total time is bounded regardless of how much stale
// branch/claim/console state has accumulated (#820, D4). Deliberately not a
// per-check timeout — those already exist (git-exec's DEFAULT_TIMEOUT_MS,
// each gh call's own 5s) — this bounds the SUM across the whole pass.
'use strict';

const DEFAULT_BUDGET_MS = 18000;

// The detached `reconcile-background` pass is off the session's hot path, so
// the 18 s hot-path ceiling would starve it: release + archive +
// archive-branches alone take ~19 s in steady state, leaving remote-prune,
// ledger-residue and reap skipped as budget-exceeded on every pass (#4032). It
// stays bounded (never Infinity — #820 D4), just above the ~45 s measured
// steady state and well under background-lock.js's 5-minute STALE_LOCK_MS. The
// budget is checked only between checks, so a pass can overrun it by one
// check's duration; that 2.5x headroom is what keeps a running pass from being
// reclaimed as a stale lock.
const BACKGROUND_BUDGET_MS = 120000;

// nowFn is injectable — no Date.now() call baked into exceeded()/remainingMs()
// themselves — matching cache.js's isFresh() purity convention for this same
// feature (#820 review): a test can pass a fake clock instead of sleeping on
// a real one to observe a deadline pass.
function createBudget(ms = DEFAULT_BUDGET_MS, nowFn = Date.now) {
  const deadline = nowFn() + ms;
  return {
    exceeded: () => nowFn() >= deadline,
    remainingMs: () => Math.max(0, deadline - nowFn()),
  };
}

module.exports = { createBudget, DEFAULT_BUDGET_MS, BACKGROUND_BUDGET_MS };
