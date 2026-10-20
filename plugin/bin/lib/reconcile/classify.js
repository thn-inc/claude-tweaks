// bin/lib/reconcile/classify.js — mirror-branch classification against
// origin, under the pr-first integration model. Fetches first by default:
// git status/branch comparisons carry no freshness information before a
// fetch (see this module's Gotchas in the design record for #407) — unless
// opts.skipFetch says the caller already refreshed origin/* this pass via
// reconcile()'s shared fetch (#820 D2).
'use strict';
const { runGit } = require('../hooks/git-exec');

// Budget for the mirror fetch specifically — separate from git-exec's
// general-purpose DEFAULT_TIMEOUT_MS (10s) because this runs on hot paths
// (session-start, dispatch queue pull) where a slow remote must not stall
// the caller for the full general budget.
//
// It governs both places a mirror fetch is issued: this module's own fetch
// below (the `!opts.skipFetch` path), and shared-fetch.js's mirror-only
// shape, which imports this constant rather than redefining the same number
// (#820 final review). reconcile() itself always passes `skipFetch: true`,
// so in production this budget binds through shared-fetch.js; the fetch
// below is what a direct classifyMirror/mirrorFastForward caller gets.
const FETCH_TIMEOUT_MS = 5000;

// repoRoot, integration branch name -> { state, failure }.
//   state: 'current' | 'behind' | 'ahead' | 'diverged' | 'dirty' | null
//   failure: a git-exec FAILURE kind when state is null (indeterminate),
//            otherwise null
// The working tree is checked BEFORE the fetch — a dirty tree makes any
// merge unsafe regardless of what the fetch would report, and skipping an
// unnecessary fetch keeps the dirty-tree case cheap.
//
// opts.skipFetch: trust the caller already refreshed origin/* this pass
// (reconcile()'s shared fetch, #820 D2) instead of fetching again here.
function classifyMirror(repoRoot, integration, opts = {}) {
  const status = runGit(['--no-optional-locks', 'status', '--porcelain'], repoRoot); // git-path-read: not a path list (emptiness only)
  if (status.failure) return { state: null, failure: status.failure };
  if (status.stdout !== '') return { state: 'dirty', failure: null };

  if (!opts.skipFetch) {
    const fetch = runGit(['fetch', 'origin', integration], repoRoot, { timeoutMs: FETCH_TIMEOUT_MS });
    if (fetch.failure) return { state: null, failure: fetch.failure };
  }

  // Left count = commits only on the local branch (ahead); right count =
  // commits only on origin's copy (behind) — see `git rev-list`'s
  // --left-right docs. Never `git status`/`git branch -vv` for this: those
  // report against whatever was fetched last, not this call's fresh fetch.
  const counts = runGit(['rev-list', '--left-right', '--count', `${integration}...origin/${integration}`], repoRoot);
  if (counts.failure) return { state: null, failure: counts.failure };
  const parts = counts.stdout.split(/\s+/).map(Number);
  const [ahead, behind] = parts;
  if (parts.length !== 2 || !Number.isFinite(ahead) || !Number.isFinite(behind)) {
    return { state: null, failure: 'git-error' };
  }
  if (ahead === 0 && behind === 0) return { state: 'current', failure: null };
  if (ahead === 0 && behind > 0) return { state: 'behind', failure: null };
  if (ahead > 0 && behind === 0) return { state: 'ahead', failure: null };
  return { state: 'diverged', failure: null };
}

module.exports = { classifyMirror, FETCH_TIMEOUT_MS };
