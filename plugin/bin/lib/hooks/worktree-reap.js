// bin/lib/hooks/worktree-reap.js — decide which linked worktrees are safe to
// remove, and remove them. Safe means: the harness owns it, nobody is using
// it, its work is already in the integration branch, and it holds nothing that
// exists only here.
//
// Every predicate below fails CLOSED. An unparseable lock reason, an
// unresolvable branch, an unresolvable cwd, or a git call that doesn't answer
// all resolve to "not eligible" — never to "eligible". There is no policy key
// to disable reaping, so the predicate is the only safety mechanism.
'use strict';

// `git worktree list --porcelain` emits blank-line-separated stanzas of
// `key value` lines. The `locked` line is either bare or carries a reason,
// and the harness writes the owning session's pid into that reason:
//   locked claude session <name> (pid 29881 start Fri Aug  7 14:40:15 2026)
// That format belongs to a tool this plugin neither owns nor version-pins, so
// it is parsed defensively and tested against a frozen fixture, never live
// output: if it changes shape, pid comes back null and nothing is reaped.
const fs = require('fs');
const path = require('path');
const { runGit } = require('./git-exec');
const { mainCheckoutRoot, safeReal } = require('./worktree-detect');
const policy = require('../policy');
const { release: releasePortsDefault } = require('../ports/registry');
const { isPathContained } = require('../shared-primitives');

const PID_RE = /\(pid\s+(\d+)\b/;

// The harness-owned worktree domain, relative to the MAIN checkout root.
// ADR-0004 (docs/decisions/0004-worktree-two-domain-convention.md) treats
// `.claude/worktrees/` (native `EnterWorktree`, harness-cleaned) and
// `.worktrees/` (raw `git worktree add`, cleaned by superpowers'
// finishing-a-development-branch) as two permanently separate ownership
// domains, and the design's Non-goals name the second as out of scope.
//
// This is a scope restriction, not a detection mechanism — worktrees are still
// ENUMERATED via `git worktree list`, as ADR-0004 requires. The restriction is
// load-bearing rather than cosmetic: a `.worktrees/` worktree is created by raw
// `git worktree add` and is therefore NEVER locked, so lock resolution — the
// one guard that protects a live session's ground — is structurally absent for
// that entire domain. A fresh, unlocked, commit-less `.worktrees/` worktree
// otherwise clears criteria 4 and 5 trivially and gets removed out from under
// whoever is standing in it.
const HARNESS_WORKTREE_DIR = path.join('.claude', 'worktrees');

// An `orphaned` verdict is not on its own evidence that a worktree is
// finished. The lock's pid is stamped once, at creation, so a session resumed
// after a process restart carries a pid that no longer exists while the
// session itself is very much alive. That worktree is typically the "Kept
// as-is" outcome `skills/wrap-up/cleanup-procedures.md` Section C step 3
// documents: merged and clean, so criteria 4 and 5 both pass, and the lock is
// the only thing left protecting it. The design's failure analysis covered pid
// REUSE (which fails safe — a recycled pid reads as alive) and missed pid
// CHANGE while the session lives, which fails the other way.
//
// 24h: longer than any plausible pause inside one working session (an
// overnight break included), and short enough that a genuinely abandoned
// worktree is still collected by the next day's first session. Reaping is
// idempotent across sessions, so waiting only ever defers the work.
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

// Ceiling on how many candidates pay for the two expensive per-worktree git
// calls in one invocation. Measured on this repo: ~0.37s for
// `git diff --name-only` plus ~0.27s for `git status --ignored`, so each
// examined candidate costs ~0.64s of a SessionStart the rest of which is
// milliseconds (git-exec.js sizes its own budget the same way). Three keeps
// the reaper under ~2s regardless of how many worktrees a repo accumulates —
// the observed case was 7, adding ~4.5s to every single session start.
// Deferring is free: reaping is idempotent across sessions, so whatever this
// cap skips is examined by the next one.
const MAX_EXAMINED_PER_RUN = 3;

const REASON = {
  IN_USE: 'in use by a live session',
  UNKNOWN_LOCK: 'lock reason unrecognized',
  OUT_OF_DOMAIN: `outside the harness worktree domain (${HARNESS_WORKTREE_DIR}/)`,
  RECENT: 'lock owner is gone, but the worktree was modified within the grace period',
};

// Skip reasons that are the normal, expected state of a healthy repo and would
// otherwise be reprinted on every single SessionStart. Consumed by
// session-start.js, which reports only the reasons NOT in this set.
const QUIET_SKIP_REASONS = new Set([REASON.IN_USE, REASON.OUT_OF_DOMAIN, REASON.RECENT]);

function parseWorktreeList(porcelain) {
  const out = [];
  let cur = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  for (const line of String(porcelain || '').split('\n')) {
    if (line === '') { flush(); continue; }
    const sp = line.indexOf(' ');
    const key = sp === -1 ? line : line.slice(0, sp);
    const val = sp === -1 ? '' : line.slice(sp + 1);
    if (key === 'worktree') {
      flush();
      cur = { path: val, branch: null, bare: false, locked: false, lockReason: null, pid: null };
      continue;
    }
    if (!cur) continue;
    if (key === 'branch') cur.branch = val.replace(/^refs\/heads\//, '');
    else if (key === 'bare') cur.bare = true;
    else if (key === 'locked') {
      cur.locked = true;
      cur.lockReason = val || null;
      const m = val ? PID_RE.exec(val) : null;
      cur.pid = m ? Number(m[1]) : null;
    }
  }
  flush();
  return out;
}

// signal 0 tests for existence without delivering anything. ESRCH means no
// such process; EPERM means it exists but belongs to another user, which is
// still alive. Both directions of pid reuse are safe here: a recycled pid
// reads as alive and the worktree is skipped, and there is no input on which
// a live session reads as dead. The failure mode is always under-reaping.
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

//   'free'     — nothing holds it
//   'in-use'   — a live session holds it; never touch
//   'orphaned' — a session held it and died without releasing. NOT sufficient
//                on its own: see isStale() and ORPHAN_GRACE_MS above.
//   'unknown'  — locked, but the reason yielded no pid. Surface, never act.
function lockVerdict(entry) {
  if (!entry.locked) return 'free';
  if (!Number.isInteger(entry.pid)) return 'unknown';
  return isPidAlive(entry.pid) ? 'in-use' : 'orphaned';
}

// Skipped wholesale. `.git` is git's own bookkeeping, and hasLocalOnlyContent()
// below runs `git status` INSIDE the worktree, which can rewrite the index — an
// admin-dir signal would be perturbed by the reaper itself, making every
// candidate look freshly touched. `node_modules` is enormous and is never
// evidence of a human being present.
const MTIME_SCAN_SKIP = new Set(['.git', 'node_modules']);

// A pathological tree must not turn a per-candidate check into an unbounded
// SessionStart cost. Measured on this repo, a worktree is ~900 entries and
// 20-50ms, so this is ~5x headroom. Exhausting it returns null, which reads as
// NOT stale and keeps the worktree — a partial answer is precisely the defect
// this replaced (#199): a scan seeing only part of the tree reports stale while
// the part it never looked at is fresh.
const MTIME_SCAN_BUDGET = 5000;

// Newest mtime anywhere in the worktree, or null when that cannot be
// determined. Recursive, deliberately: the shallow depth-1 scan this replaces
// reported a live worktree in this very repo as 24.5h idle when its actual
// newest write was 22.5h old, four levels down. Directory mtimes do not
// propagate upward, so an in-place write to `wt/a/b/c.js` moves nothing above
// it — depth alone was never a safe proxy for activity.
function newestMtimeMs(wtPath) {
  let newest = null;
  let budget = MTIME_SCAN_BUDGET;
  const bump = (p) => {
    try {
      const st = fs.lstatSync(p);
      if (newest === null || st.mtimeMs > newest) newest = st.mtimeMs;
    } catch { /* unreadable entry — ignore, the others still speak */ }
  };
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return true; }
    for (const e of entries) {
      if (MTIME_SCAN_SKIP.has(e.name)) continue;
      if (budget-- <= 0) return false;
      const p = path.join(dir, e.name);
      bump(p);
      if (e.isDirectory() && !walk(p)) return false;
    }
    return true;
  };
  try { fs.readdirSync(wtPath); } catch { return null; }
  bump(wtPath);
  return walk(wtPath) ? newest : null;
}

// Has nothing happened in this worktree for at least `graceMs`? See
// ORPHAN_GRACE_MS above for why an orphaned lock alone is not enough.
function isStale(wtPath, now = Date.now(), graceMs = ORPHAN_GRACE_MS) {
  const newest = newestMtimeMs(wtPath);
  if (newest === null) return false;
  return now - newest >= graceMs;
}

// Content identity, deliberately NOT `git merge-base --is-ancestor`. A branch
// merged with `gh pr merge --rebase` has its shas rewritten, so it is
// permanently a non-ancestor of the integration branch even though every line
// of its content landed there. This repo favors rebase merges, so an ancestry
// check would refuse to reap the common case (see #106, the same trap in
// [IL-45]'s sha-identity check).
//
// An empty `git diff --name-only A B` means the two trees are identical.
// Any failure to answer returns false: unresolvable is not identical.
function isContentIdentical(repoRoot, branch, integration) {
  if (!branch || !integration) return false;
  const { stdout, failure } = runGit(['diff', '--name-only', integration, branch], repoRoot);
  if (failure) return false;
  return stdout.trim() === '';
}

// Anything still present in the worktree that git does not already have a
// copy of elsewhere. --ignored is the point: [IL-46]'s actual incident was a
// gitignored scratch file holding a decision nobody had recorded anywhere
// else, and merge status is silent about it. Phase 1 moved claude-tweaks' own
// run state out of the worktree; this catches everyone else's.
function hasLocalOnlyContent(wtPath) {
  const { stdout, failure } = runGit(['status', '--porcelain', '--ignored'], wtPath);
  if (failure) return true; // can't tell -> assume yes
  return stdout.trim() !== '';
}

// The harness domain as an absolute, symlink-resolved path, so membership is a
// path-prefix test against the MAIN checkout root rather than a naive
// substring match on `.claude/worktrees` anywhere in the string.
function harnessDomainOf(root) {
  const dir = path.join(root, HARNESS_WORKTREE_DIR);
  return safeReal(dir) || dir;
}

function reapWorktrees({
  cwd, integration, dryRun = false, now = Date.now(), releasePorts = releasePortsDefault,
} = {}) {
  const reaped = [];
  const skipped = [];
  let deferred = 0;
  // Release notes only — reaped/skipped/deferred above are unaffected by a
  // release failure (#1793): a lease-release throw is never a reason to
  // treat the worktree removal itself as failed. Only ever populated on a
  // throw — a no-lease path is a no-op release, reported here as nothing,
  // matching #1791 AC6's release contract.
  const portsRelease = [];
  const start = cwd || process.cwd();
  const root = mainCheckoutRoot(start);
  if (!root) return { reaped, skipped, deferred, portsRelease };

  // Fail CLOSED on an unresolvable cwd. This guard exists to keep the caller's
  // own ground out of the candidate set, so "we cannot tell where the caller
  // is standing" must reap nothing — short-circuiting the comparison on a null
  // `here` (the original `here && ...` form) turned a fail-closed predicate
  // into a fail-open one at exactly the point it matters most.
  const here = safeReal(start);
  if (!here) return { reaped, skipped, deferred, portsRelease };

  const { stdout, failure } = runGit(['worktree', 'list', '--porcelain'], root);
  if (failure) return { reaped, skipped, deferred, portsRelease };

  const domain = harnessDomainOf(root);
  let examined = 0;
  for (const wt of parseWorktreeList(stdout)) {
    const real = safeReal(wt.path);
    if (!real || real === root || wt.bare) continue;      // never the main checkout
    if (isPathContained(here, real, { orEqual: true })) continue; // never our own ground

    if (!isPathContained(real, domain)) {
      skipped.push({ path: real, reason: REASON.OUT_OF_DOMAIN });
      continue;
    }

    const verdict = lockVerdict(wt);
    if (verdict !== 'free' && verdict !== 'orphaned') {
      skipped.push({ path: real, reason: verdict === 'in-use' ? REASON.IN_USE : REASON.UNKNOWN_LOCK });
      continue;
    }
    if (verdict === 'orphaned' && !isStale(real, now)) {
      skipped.push({ path: real, reason: REASON.RECENT });
      continue;
    }

    // Everything above is fs-only or already-parsed; everything below forks
    // git into this worktree. The cap sits exactly on that boundary.
    if (examined >= MAX_EXAMINED_PER_RUN) { deferred += 1; continue; }
    examined += 1;

    if (!isContentIdentical(root, wt.branch, integration)) {
      skipped.push({ path: real, reason: 'not merged into ' + integration });
      continue;
    }
    if (hasLocalOnlyContent(real)) {
      skipped.push({ path: real, reason: 'holds local content that exists nowhere else' });
      continue;
    }
    if (dryRun) { reaped.push(real); continue; }

    if (verdict === 'orphaned') runGit(['worktree', 'unlock', real], root);
    const rm = runGit(['worktree', 'remove', real], root);
    if (rm.failure) { skipped.push({ path: real, reason: 'removal failed' }); continue; }
    reaped.push(real);
    try {
      releasePorts(real);
    } catch (err) {
      portsRelease.push({ path: real, note: `failed: ${(err && err.message) || err}` });
    }
  }
  return { reaped, skipped, deferred, portsRelease };
}

// The canonical ladder in `skills/_shared/integration-branch.md`, restricted to
// the ranks a SessionStart hook can actually evaluate:
//
//   rank 3 — `integration-branch:` in .claude-tweaks/policy.yml
//   rank 5 — the GitHub default branch, read offline from refs/remotes/origin/HEAD
//
// Rank 1 (an explicit argument) and rank 2 (a routine template) have no hook
// equivalent, and rank 4 (a branching model stated in CLAUDE.md prose) needs a
// reader rather than a parser.
//
// Rank 5's OTHER half — `git branch --show-current` / `git symbolic-ref HEAD`
// on the main checkout — is deliberately NOT a source here. That is the
// fragment's own named anti-pattern ("Using the branch the main checkout
// currently has checked out"), and it is the reason /dispatch's merge guard and
// wrap-up's review console both carry an explicit "a concurrent session
// switched it, abort" check. The reaper measures merge state against whatever
// this returns and then DELETES on the answer, so the anti-pattern is worse
// here than anywhere else: a probe reaped a worktree holding genuinely
// unmerged work purely because the main checkout had been switched underfoot.
//
// Null means nothing resolved. The caller reaps nothing rather than measuring
// against a guess — the per-consumer fallback recorded for this consumer in
// `_shared/integration-branch.md`'s table.
// `cache` (optional): { integrationBranch: Map<repoRoot, name|null>, ... } — same opt-in,
// per-invocation shape `run-integrity.js`'s deriveBranch takes. The policy short-circuit runs
// BEFORE any cache lookup regardless: a project with an `integration-branch` policy value never
// spawns `git rev-parse` at all, cache or no cache. Omitted, this spawns fresh every call. See #381.
// #1688's second gap: `integration-branch:` in policy.yml names a LOCAL
// branch, which can lag `origin/{name}` -- `_shared/worktree-setup.md`'s
// post-creation catch-up merges the remote-tracking branch into a worktree's
// HEAD routinely, so a caller comparing against the stale local name can find
// those already-merged commits still inside its own range/merge-base
// computation. Upgrade to the remote-tracking ref when one already exists on
// disk -- read-only, no fetch (this resolver must stay offline and cheap; see
// hasMaterializeCommit's own comment on the same constraint). Never invents a
// branch and never changes whether resolution succeeds: it only refines an
// already-resolved name to its freshest known equivalent.
//
// Scoped to the policy-configured path only. The origin/HEAD-derived path a
// few lines below is deliberately left as the bare name it has always
// returned -- it is already the freshest signal available (origin/HEAD's own
// target), and existing callers/tests depend on that exact bare-name shape.
function preferRemoteTrackingRef(repoRoot, name) {
  const { failure } = runGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`], repoRoot);
  return failure ? name : `origin/${name}`;
}

function resolveIntegrationBranch(repoRoot, cache) {
  if (!repoRoot) return null;
  const fromPolicy = policy.readIntegrationBranch(repoRoot);
  if (fromPolicy) return preferRemoteTrackingRef(repoRoot, fromPolicy);
  if (cache && cache.integrationBranch.has(repoRoot)) return cache.integrationBranch.get(repoRoot);
  const { stdout, failure } = runGit(['rev-parse', '--abbrev-ref', 'origin/HEAD'], repoRoot);
  const name = failure || !stdout ? null : stdout.trim().replace(/^origin\//, '') || null;
  if (cache) cache.integrationBranch.set(repoRoot, name);
  return name;
}

// The inverse of preferRemoteTrackingRef, for a caller that needs a BARE
// branch name: a `git fetch origin -- {name}` refspec (looked up on the
// remote side, which has no `origin/`-prefixed branches), or an equality
// comparison against a value that is always bare (`git branch --show-current`,
// `readDefaultBranch`'s own origin/HEAD strip in merge-verification.js).
// resolveIntegrationBranch's policy-configured path can now return either
// shape (preferRemoteTrackingRef above) -- every caller that builds its own
// `origin/${name}` ref or compares against a bare name must normalize
// through this first. A value with no `origin/` prefix, or a nullish value,
// passes through unchanged -- safe to call unconditionally.
function bareIntegrationName(name) {
  return name ? name.replace(/^origin\//, '') : name;
}

// Is this worktree path held by a live session right now? The one predicate
// #407's reconciler needs from this module — exported so it consumes the
// same pid-parsing logic reapWorktrees does above, rather than a second copy.
// Fails CLOSED, same posture as every other predicate in this file: an
// unresolvable root, a failed `git worktree list`, or no matching entry all
// read as "cannot confirm it's free" except the last, which genuinely means
// there is nothing here to lock (not registered at all).
function isWorktreeLocked(wtPath, { cwd } = {}) {
  const root = mainCheckoutRoot(cwd || wtPath);
  if (!root) return true;
  const { stdout, failure } = runGit(['worktree', 'list', '--porcelain'], root);
  if (failure) return true;
  const target = safeReal(wtPath) || wtPath;
  for (const entry of parseWorktreeList(stdout)) {
    const real = safeReal(entry.path) || entry.path;
    if (real !== target && entry.path !== wtPath) continue;
    return lockVerdict(entry) === 'in-use';
  }
  return false;
}

module.exports = {
  parseWorktreeList,
  isPidAlive,
  lockVerdict,
  newestMtimeMs,
  isStale,
  isContentIdentical,
  reapWorktrees,
  resolveIntegrationBranch,
  preferRemoteTrackingRef,
  bareIntegrationName,
  isWorktreeLocked,
  HARNESS_WORKTREE_DIR,
  ORPHAN_GRACE_MS,
  MAX_EXAMINED_PER_RUN,
  QUIET_SKIP_REASONS,
  REASON,
};
