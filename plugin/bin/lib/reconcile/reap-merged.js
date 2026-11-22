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
// A third guard covers a live session in ANOTHER process: dispatch worktrees
// are unlocked, so the session leaves a hold in the worktree's git admin dir
// and `holdVerdict` reads it (#4960).
'use strict';
const fs = require('fs');
const path = require('path');
const { runGit, repoTargetOf } = require('../hooks/git-exec');
const { mainCheckoutRoot, safeReal } = require('../hooks/worktree-detect');
const { parseWorktreeList, isWorktreeLocked, holdVerdict, HARNESS_WORKTREE_DIR, QUIET_SKIP_REASONS } = require('../hooks/worktree-reap');
const { isPathContained } = require('../shared-primitives');
const { resolvePrState } = require('./pr-state');
const { canonicalRealpath } = require('../path-guard');
const { findRunByWorktreePath, worktreeMatches, iterRunDirsWithState, readRunState, isAdHocRunDir, priorWorktree, RUN_ID_RE, appendEvent } = require('../hooks/context');
const { release: releasePortsDefault } = require('../ports/registry');
const { trackResidue, beginCacheBatch, commitCacheBatch } = require('./cache');
const { escalateResidue, capDirtyFiles, residueRepoOf } = require('./escalate-residue');
const { readPorcelainStatus } = require('../residue/probes/worktrees');

// Best-effort audit-trail write to the OWNING run's own events.jsonl, so
// wrap-up/residue tooling that reads a run's events can see that the
// background reconciler examined its worktree — this used to be implicit
// (the reap check ran inline in session-start.js, in the same process that
// had ownedRun context); moving it to the detached reconcile-background
// subcommand (#820 D8) dropped that trail entirely (review finding). Never
// blocks or fails the reap itself — a run this worktree can't be joined to
// (no run-state.json, or no run recording this path) simply gets no event. A
// closed or archived run is joined for the reap event only (#4960).
function logReapEvent(runDir, type, data) {
  if (!runDir) return;
  try { appendEvent(runDir, type, data); } catch { /* best-effort */ }
}

// The closed and archived tiers compare through the same canonicalizer as the live tier
// (context.js's worktreeMatches: path-guard's .native canonicalRealpath, #3769), so a case-only
// mismatch on a case-insensitive volume joins on every tier.
function recordedMatches(state, real, canonical, target) {
  return worktreeMatches({ worktree: priorWorktree(state) }, target, real, canonical);
}

// One reap pass's reads of the closed and archived tiers, shared by every worktree's lookup:
// each run's state is read at most once however many worktrees ask. Both tiers fill lazily, so
// a lookup that stops early never pays for the rest.
function createRunLookupMemo() {
  return { cleanIter: null, cleanSeen: [], archiveNames: null, archiveStates: new Map() };
}

function* cleanRuns(root, memo) {
  for (let i = 0; ; i++) {
    if (i < memo.cleanSeen.length) { yield memo.cleanSeen[i]; continue; }
    if (!memo.cleanIter) memo.cleanIter = iterRunDirsWithState(root, { status: 'clean' });
    const next = memo.cleanIter.next();
    if (next.done) return;
    memo.cleanSeen.push(next.value);
    yield next.value;
  }
}

function archivedState(dir, memo) {
  if (!memo.archiveStates.has(dir)) memo.archiveStates.set(dir, readRunState(dir));
  return memo.archiveStates.get(dir);
}

// Resolves the owning run dir BEFORE any removal — findRunByWorktreePath
// realpath-resolves both sides of the join itself, which only succeeds while
// the worktree directory still exists on disk; calling it after `git
// worktree remove` has already deleted the directory makes its own
// canonicalRealpath return null and silently fall back to a raw, un-resolved form
// that no longer string-matches the pre-resolved `real` path this loop
// already has (caught in review: the removal itself worked, but the join
// silently found nothing every time).
// skipAdHoc (#2783): an `-adhoc-standalone` twin, minted after /flow's formal
// run, sorts newer and would otherwise take the formal run's reap trail.
// #4960: `includeClosed` (the worktree-reaped call only) also searches closed
// (clean) and archived runs — the same reconcile pass archives a merged run
// before it reaps the worktree, so the owning run is usually already closed by
// now. Worktree paths repeat per record, so the NEWEST run id across both
// tiers wins. Skip events keep the live-only lookup: a closed run would
// otherwise take an unbounded skip line per pass and every pass would scan the
// whole archive.
// `memo` (createRunLookupMemo) lets a reap pass share its closed/archived reads across lookups.
function resolveOwningRunDir(root, real, { includeClosed = false, fsImpl, memo = createRunLookupMemo() } = {}) {
  try {
    const live = findRunByWorktreePath(root, real, { skipAdHoc: true, fsImpl });
    if (live) return live.runDir;
    if (!includeClosed) return null;
    const canonical = (p) => canonicalRealpath(p, { fsImpl });
    const target = canonical(real) || real;
    let clean = null;
    for (const { dir, state } of cleanRuns(root, memo)) {
      if (isAdHocRunDir(dir)) continue;
      if (recordedMatches(state, real, canonical, target)) { clean = dir; break; }
    }
    let archived = null;
    const archiveBase = path.join(root, '.claude-tweaks', 'pipelines', 'archive');
    if (!memo.archiveNames) {
      let names = [];
      try { names = fs.readdirSync(archiveBase); } catch { /* no archive dir */ }
      memo.archiveNames = names.filter((n) => RUN_ID_RE.test(n)).sort().reverse();
    }
    for (const name of memo.archiveNames) {
      // Newest first: once the clean tier matched, an archived name at or below its basename can
      // never win the comparison below, so stop reading. Only the no-match full scan stays; it
      // runs once per reap, in the background.
      if (clean && name <= path.basename(clean)) break;
      const dir = path.join(archiveBase, name);
      if (isAdHocRunDir(dir)) continue;
      if (recordedMatches(archivedState(dir, memo), real, canonical, target)) { archived = dir; break; }
    }
    if (clean && archived) return path.basename(clean) > path.basename(archived) ? clean : archived;
    return clean || archived;
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
function trackReapResidue(cacheTarget, residueRepo, real, { failed, lastError, dirtyFiles }, { escalate = escalateResidue, runner } = {}) {
  trackResidue(cacheTarget, residueRepo, 'removal-failed', real, { failed, lastError, dirtyFiles }, { escalate, runner });
}

// #2566 — Windows's MAX_PATH limit frequently makes `git worktree remove`
// fail with "Filename too long" on a deep pnpm/Node `node_modules` tree,
// leaving git's own worktree registration half-unregistered (`prunable`)
// while the directory stays on disk. The `\\?\` extended-length prefix lets
// `fs.rmSync` bypass that limit — but it is Windows-only: on POSIX, `\` is
// an ordinary filename character rather than a path-separator escape, so
// prepending it would make `fs.rmSync` look for a literal path that doesn't
// exist and silently no-op under `force: true` instead of actually removing
// anything. `platform` defaults to `process.platform` but is an explicit
// param (not stubbed globally) — same per-call injection seam
// `hooks-post-tool-use-worktree-staleness.test.js` already established for
// this exact reason: `process.platform` is process-global and stubbing it
// would leak across tests run in the same worker.
function longPathRemovalTarget(real, platform = process.platform) {
  return platform === 'win32' ? `\\\\?\\${real}` : real;
}

// #2566 follow-up — `platform === 'win32'` alone cannot tell a deletion git
// started and could not finish (the "Filename too long" case) from a removal
// git REFUSED for safety (a locked worktree, a dirty one). Neither can the
// candidate's own path length: the reported failure is a deep `node_modules`
// descendant under an ordinary-length `.claude/worktrees/{name}` root, and a
// long root can just as well be locked or dirty. The discriminator is git's
// own registration after the failed `git worktree remove`: a refusal exits
// before touching anything, leaving the worktree registered and healthy; a
// mid-deletion failure happens after git has already approved the removal,
// leaving the entry gone from `git worktree list` or marked `prunable`
// (observed against git 2.55: a refusal leaves it registered, a mid-delete
// failure leaves it unregistered with the directory still on disk).
// Finishing a deletion git itself already committed to is safe; touching a
// worktree git refused is not. An unreadable list fails closed — and so
// does a single registered entry whose own path cannot be resolved for any
// reason other than ENOENT (#2935): such an entry can never be silently
// treated as non-matching (there is no way to prove it isn't the target),
// so its resolution failure short-circuits the whole function to `false`
// rather than falling back to an unresolved, possibly-mismatching raw path.
function gitCommittedToRemoval(real, root, { realpath = fs.realpathSync } = {}) {
  const list = runGit(['worktree', 'list', '--porcelain'], root);
  if (list.failure) return false;
  let entry;
  for (const wt of parseWorktreeList(list.stdout)) {
    let resolved;
    try {
      resolved = realpath(wt.path);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue; // cannot be the existing target directory
      return false; // any other resolution failure fails closed
    }
    if (resolved === real) { entry = wt; break; }
  }
  return !entry || entry.prunable;
}

// Tried once, only after `git worktree remove` has already failed — never
// instead of it, and gated to `win32` AND a removal git had already
// committed to (gitCommittedToRemoval above): a refused removal (locked,
// dirty) is a REAL failure this fallback must never paper over by
// force-deleting a directory git itself refused to touch, so it falls
// through to the existing removal-failed escalation path unchanged. When it
// does run, also verifies the directory is actually gone (`force: true`
// only swallows ENOENT, not other errors, but the extra check costs nothing)
// before running `git worktree prune` to clear any `prunable` registration.
function attemptLongPathRemoval(real, root, { fsRmSync = fs.rmSync, platform = process.platform } = {}) {
  if (platform !== 'win32' || !gitCommittedToRemoval(real, root)) return { succeeded: false, lastError: null };
  try {
    fsRmSync(longPathRemovalTarget(real, platform), { recursive: true, force: true, maxRetries: 3 });
  } catch (err) {
    return { succeeded: false, lastError: (err && err.message) || String(err) };
  }
  if (fs.existsSync(real)) {
    return { succeeded: false, lastError: 'fs.rmSync completed without removing the directory' };
  }
  const prune = runGit(['worktree', 'prune'], root);
  if (prune.failure) {
    return { succeeded: false, lastError: prune.stderr || prune.failure };
  }
  return { succeeded: true };
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

// #4032: warm the pass's PR-state resolver for every worktree branch
// reapMerged will look up, concurrently, so its sequential loop hits the memo.
// Skips what the loop skips before the lookup (the main checkout, bare entries,
// branchless entries, paths outside the harness domain); a candidate the loop
// then skips for another reason (own-cwd, locked) is warmed needlessly, which
// costs one cached lookup and nothing else.
async function prefetchReapPrStates(root, prStates) {
  const list = runGit(['worktree', 'list', '--porcelain'], root);
  if (list.failure) return;
  const domain = safeReal(path.join(root, HARNESS_WORKTREE_DIR)) || path.join(root, HARNESS_WORKTREE_DIR);
  const branches = [];
  for (const wt of parseWorktreeList(list.stdout)) {
    const real = safeReal(wt.path);
    if (!real || real === root || wt.bare || !wt.branch) continue;
    if (!isPathContained(real, domain)) continue;
    branches.push(wt.branch);
  }
  await prStates.prefetch({ branches });
}

function reapMerged({
  cwd, dryRun = false, releasePorts = releasePortsDefault, runner, fsRmSync, platform, prStates, gateDeps,
} = {}) {
  const reaped = [];
  const skipped = [];
  // See worktree-reap.js's reapWorktrees for the shape rationale: only ever
  // populated on a release throw, never for the common success/no-lease case.
  const portsRelease = [];
  const start = cwd || process.cwd();
  const root = mainCheckoutRoot(start);
  if (!root) return { reaped, skipped, portsRelease };
  const here = safeReal(start);
  // #4794: the residue repo is the --repo value for the origin's one host (bare on gh's default host),
  // or `{ refusal }` for a refused origin, which files nothing and calls no gh.
  const residueRepo = residueRepoOf(repoTargetOf(root, gateDeps));

  const list = runGit(['worktree', 'list', '--porcelain'], root);
  if (list.failure) return { reaped, skipped, portsRelease, failure: list.failure };

  // #1235: one read before the loop, one write after — instead of one
  // read-modify-write per reaped/failed candidate. See cache.js's
  // `beginCacheBatch` for the atomicity tradeoff this accepts.
  const cacheBatch = beginCacheBatch(root);
  const runMemo = createRunLookupMemo();
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
    // A live session in another process, read from its hold (#4960). 'held' writes no event and, like 'in-use', stays off the SessionStart banner (QUIET_SKIP_REASONS);
    // a hold that cannot be verified keeps the worktree and is logged, so a stuck one surfaces.
    const held = holdVerdict(real);
    if (held === 'held') { skipped.push({ path: real, reason: 'held' }); continue; }
    if (held === 'unverifiable') {
      skipped.push({ path: real, reason: 'held-unverifiable' });
      if (!dryRun) logReapEvent(resolveOwningRunDir(root, real), 'worktree-reap-skipped', { reason: 'held-unverifiable' });
      continue;
    }

    const prState = prStates ? prStates.byBranch(wt.branch) : resolvePrState(root, wt.branch);
    const decision = decideReap(prState);
    if (decision.action === 'skip') {
      skipped.push({ path: real, reason: decision.reason, prNumber: prState && prState.number });
      // QUIET_SKIP_REASONS mirrors what the SessionStart banner already
      // filters (worktree-reap.js's own noise-reduction convention) — a
      // live session's own worktree gets 'in-use' on every ~7-minute
      // background pass for the length of the session, which would flood
      // its events.jsonl with nothing new to say each time.
      // #4180: not on a dry run — the append writes a run's events.jsonl.
      if (!dryRun && !QUIET_SKIP_REASONS.has(decision.reason)) {
        logReapEvent(resolveOwningRunDir(root, real), 'worktree-reap-skipped', { reason: decision.reason, prNumber: prState && prState.number });
      }
      continue;
    }
    if (dryRun) { reaped.push(real); continue; }

    // Resolved before removal — see resolveOwningRunDir's own header comment.
    const owningRunDir = resolveOwningRunDir(root, real, { includeClosed: true, memo: runMemo });
    const rm = runGit(['worktree', 'remove', real], root);
    if (rm.failure) {
      // #2566 — before escalating, try the long-path fallback: it succeeds
      // exactly where a deep `node_modules` tree made `git worktree remove`
      // fail with Windows's "Filename too long", and is a harmless no-op
      // attempt on a failure `git worktree prune` can't itself resolve
      // (e.g. a genuine permissions error still falls through below).
      const fallback = attemptLongPathRemoval(real, root, { fsRmSync, platform });
      if (fallback.succeeded) {
        trackReapResidue(cacheBatch, residueRepo, real, { failed: false }, { runner });
        logReapEvent(owningRunDir, 'worktree-reaped', { prNumber: prState.number });
        reaped.push(real);
        try {
          releasePorts(real);
        } catch (err) {
          portsRelease.push({ path: real, note: `failed: ${(err && err.message) || err}` });
        }
        continue;
      }
      skipped.push({ path: real, reason: 'removal-failed', prNumber: prState.number });
      logReapEvent(owningRunDir, 'worktree-reap-skipped', { reason: 'removal-failed', prNumber: prState.number });
      // #1796 — one `git status --porcelain` read against the worktree that
      // just refused removal, so the escalation issue (if this streak
      // reaches threshold) can tell a human "disposable untracked ledger"
      // from "real uncommitted work" without them shelling into the host.
      // Capped here (not left for escalate-residue.js's own render-time cap
      // to do all the work) so cache.js never persists an unbounded array —
      // capDirtyFiles is idempotent, so escalateResidue's own defensive cap
      // downstream is a no-op against this already-capped value.
      const dirtyFiles = capDirtyFiles(readPorcelainStatus(real));
      // #1341 — carry git's real stderr as lastError, falling back to the
      // bare category only when git produced no stderr at all (e.g. an
      // indeterminate timeout/spawn failure with nothing to say). The
      // long-path fallback's own lastError (above) takes precedence when it
      // ran and still failed — it is the more specific, more recent signal.
      trackReapResidue(cacheBatch, residueRepo, real, { failed: true, lastError: fallback.lastError || rm.stderr || rm.failure, dirtyFiles }, { runner });
      continue;
    }
    // A path that just succeeded has no more residue to track (#644) — clear
    // any streak so a later failure on this same path (re-created worktree,
    // reused path) starts counting fresh rather than resuming a stale one.
    trackReapResidue(cacheBatch, residueRepo, real, { failed: false }, { runner });
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

module.exports = {
  reapMerged, resolveOwningRunDir, createRunLookupMemo, prefetchReapPrStates, decideReap, isOwnCwd, trackReapResidue, attemptLongPathRemoval, longPathRemovalTarget, gitCommittedToRemoval,
};
