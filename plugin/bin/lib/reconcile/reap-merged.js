// bin/lib/reconcile/reap-merged.js — convergence check 2: reap worktrees
// whose branch's PR has merged. Parallel to (never a replacement for)
// `worktree-reap.js`'s existing content-identical ancestry check, which
// stays the reap signal for local-merge / no-forge projects — see #407's
// Non-Goals. Never touches a worktree a live session holds, regardless of
// PR state (`isWorktreeLocked`, reused verbatim from worktree-reap.js) —
// and never touches the CALLING session's own cwd worktree either (#644):
// `isWorktreeLocked` only catches a lock file another live session wrote,
// which says nothing about whether THIS process is standing inside the
// candidate right now (e.g. a session that just merged its own run's PR
// from inside that run's worktree, then calls reconcile in the same
// breath — no lock check catches that, since nothing about the lock
// changed). worktree-reap.js's own `reapWorktrees` already carries this
// exact guard (`here === real || here.startsWith(...)`, "never our own
// ground") — mirrored here rather than restated with different wording.
'use strict';
const path = require('path');
const { runGit } = require('../hooks/git-exec');
const { mainCheckoutRoot, safeReal } = require('../hooks/worktree-detect');
const { parseWorktreeList, isWorktreeLocked, HARNESS_WORKTREE_DIR, QUIET_SKIP_REASONS } = require('../hooks/worktree-reap');
const { isPathContained } = require('../shared-primitives');
const { resolvePrState } = require('./pr-state');
const { findRunByWorktreePath, appendEvent } = require('../hooks/context');
const { release: releasePortsDefault } = require('../ports/registry');
const { trackResidue, beginCacheBatch, commitCacheBatch } = require('./cache');
const { escalateResidue } = require('./escalate-residue');
const { repoSlugOf } = require('./release-merged');

// Best-effort audit-trail write to the OWNING run's own events.jsonl, so
// wrap-up/residue tooling that reads a run's events can see that the
// background reconciler examined its worktree — this used to be implicit
// (the reap check ran inline in session-start.js, in the same process that
// had ownedRun context); moving it to the detached reconcile-background
// subcommand (#820 D8) dropped that trail entirely (review finding). Never
// blocks or fails the reap itself — a run this worktree can't be joined to
// (archived run dir, no run-state.json) simply gets no event, same as
// before this fix.
function logReapEvent(runDir, type, data) {
  if (!runDir) return;
  try { appendEvent(runDir, type, data); } catch { /* best-effort */ }
}

// Resolves the owning run dir BEFORE any removal — findRunByWorktreePath
// realpath-resolves both sides of the join itself, which only succeeds while
// the worktree directory still exists on disk; calling it after `git
// worktree remove` has already deleted the directory makes its own
// fs.realpathSync throw and silently fall back to a raw, un-resolved form
// that no longer string-matches the pre-resolved `real` path this loop
// already has (caught in review: the removal itself worked, but the join
// silently found nothing every time).
function resolveOwningRunDir(root, real) {
  try {
    const found = findRunByWorktreePath(root, real);
    return found ? found.runDir : null;
  } catch { return null; }
}

// One worktree candidate's PR state -> what to do with it. Pure — no I/O —
// so the decision table is unit-testable without a real git/gh call.
//   { action: 'reap' } | { action: 'skip', reason }
// A closed-but-unmerged PR is surfaced, never auto-reaped: its worktree may
// be the resume surface for a failed run (a failure tombstone).
function decideReap(prState) {
  if (prState === 'gh-absent') return { action: 'skip', reason: 'gh-absent' };
  if (prState === 'network-failure') return { action: 'skip', reason: 'network-failure' };
  if (!prState) return { action: 'skip', reason: 'no-pr' };
  if (prState.state === 'OPEN') return { action: 'skip', reason: 'pr-open' };
  if (prState.state === 'CLOSED') return { action: 'skip', reason: 'pr-closed-unmerged' };
  return { action: 'reap' };
}

// #644 Deliverable 2 — mirrors archive-merged.js's own `trackArchiveResult`;
// both now call cache.js's shared `trackResidue` helper (#1233) rather than
// duplicating the success/fail branch. `escalate` stays injectable so a test
// can assert escalation fired (and how many times) without touching real
// `gh`. `cacheTarget` is either a plain root string (single-call behavior,
// unchanged) or a `beginCacheBatch` handle (#1235 — batched across
// `reapMerged`'s item loop); see cache.js's own comment on the two shapes.
function trackReapResidue(cacheTarget, repoSlug, real, { failed, lastError }, { escalate = escalateResidue, runner } = {}) {
  trackResidue(cacheTarget, repoSlug, 'removal-failed', real, { failed, lastError }, { escalate, runner });
}

// A candidate worktree the CALLING process is standing inside (or under),
// resolved from `cwd`/`process.cwd()` rather than any lock file — see the
// module header comment for why `isWorktreeLocked` alone doesn't catch this.
// An unresolvable `here` fails CLOSED to "cannot confirm it's not ours" —
// same posture as every other predicate in this family
// (worktree-reap.js's own header) — the caller below already treats a null
// `here` as "compare against nothing matches" via the guard at the call site.
function isOwnCwd(here, real) {
  if (!here || !real) return false;
  return isPathContained(here, real, { orEqual: true });
}

function reapMerged({ cwd, dryRun = false, releasePorts = releasePortsDefault, runner } = {}) {
  const reaped = [];
  const skipped = [];
  // See worktree-reap.js's reapWorktrees for the shape rationale: only ever
  // populated on a release throw, never for the common success/no-lease case.
  const portsRelease = [];
  const start = cwd || process.cwd();
  const root = mainCheckoutRoot(start);
  if (!root) return { reaped, skipped, portsRelease };
  const here = safeReal(start);
  const repoSlug = repoSlugOf(root);

  const list = runGit(['worktree', 'list', '--porcelain'], root);
  if (list.failure) return { reaped, skipped, portsRelease, failure: list.failure };

  // #1235: one read before the loop, one write after — instead of one
  // read-modify-write per reaped/failed candidate. See cache.js's
  // `beginCacheBatch` for the atomicity tradeoff this accepts.
  const cacheBatch = beginCacheBatch(root);
  const domain = safeReal(path.join(root, HARNESS_WORKTREE_DIR)) || path.join(root, HARNESS_WORKTREE_DIR);
  for (const wt of parseWorktreeList(list.stdout)) {
    const real = safeReal(wt.path);
    if (!real || real === root || wt.bare) continue; // never the main checkout
    if (!isPathContained(real, domain)) continue; // out of harness domain — not this check's concern

    if (!wt.branch) { skipped.push({ path: real, reason: 'no-branch' }); continue; }
    // Regardless of PR state, lock state, or anything else below — a
    // worktree the caller is standing in is never a reap candidate (#644).
    if (isOwnCwd(here, real)) { skipped.push({ path: real, reason: 'own-cwd' }); continue; }
    if (isWorktreeLocked(real, { cwd: root })) { skipped.push({ path: real, reason: 'in-use' }); continue; }

    const prState = resolvePrState(root, wt.branch);
    const decision = decideReap(prState);
    if (decision.action === 'skip') {
      skipped.push({ path: real, reason: decision.reason, prNumber: prState && prState.number });
      // QUIET_SKIP_REASONS mirrors what the SessionStart banner already
      // filters (worktree-reap.js's own noise-reduction convention) — a
      // live session's own worktree gets 'in-use' on every ~7-minute
      // background pass for the length of the session, which would flood
      // its events.jsonl with nothing new to say each time.
      if (!QUIET_SKIP_REASONS.has(decision.reason)) {
        logReapEvent(resolveOwningRunDir(root, real), 'worktree-reap-skipped', { reason: decision.reason, prNumber: prState && prState.number });
      }
      continue;
    }
    if (dryRun) { reaped.push(real); continue; }

    // Resolved before removal — see resolveOwningRunDir's own header comment.
    const owningRunDir = resolveOwningRunDir(root, real);
    const rm = runGit(['worktree', 'remove', real], root);
    if (rm.failure) {
      skipped.push({ path: real, reason: 'removal-failed', prNumber: prState.number });
      logReapEvent(owningRunDir, 'worktree-reap-skipped', { reason: 'removal-failed', prNumber: prState.number });
      // #1341 — carry git's real stderr as lastError, falling back to the
      // bare category only when git produced no stderr at all (e.g. an
      // indeterminate timeout/spawn failure with nothing to say).
      trackReapResidue(cacheBatch, repoSlug, real, { failed: true, lastError: rm.stderr || rm.failure }, { runner });
      continue;
    }
    // A path that just succeeded has no more residue to track (#644) — clear
    // any streak so a later failure on this same path (re-created worktree,
    // reused path) starts counting fresh rather than resuming a stale one.
    trackReapResidue(cacheBatch, repoSlug, real, { failed: false }, { runner });
    logReapEvent(owningRunDir, 'worktree-reaped', { prNumber: prState.number });
    reaped.push(real);
    try {
      releasePorts(real);
    } catch (err) {
      portsRelease.push({ path: real, note: `failed: ${(err && err.message) || err}` });
    }
  }
  commitCacheBatch(cacheBatch);
  return { reaped, skipped, portsRelease };
}

module.exports = { reapMerged, decideReap, isOwnCwd, trackReapResidue };
