// bin/lib/reconcile/prune-remote.js — convergence check: delete REMOTE
// branches proven merged into the integration branch. The one pushed
// mutation in the reconcile family — every other check is local-only by
// design (archive-branches.js). A pushed deletion is unrecoverable from
// this checkout once origin GCs the ref, so the evidence bar is BOTH
// signals at once: a MERGED PR — screened in one bulk call across the whole
// in-scope branch set (resolvePrStatesBulk, #1082), then reconfirmed
// per-branch (resolvePrState) for any branch the screen didn't already
// skip — AND one of two merged-in-substance proofs of the remote ref
// against the integration branch: cherry-equivalence (`git cherry`, the
// same evidence archive-branches.js documents; ancestry alone is
// explicitly not trusted) or, when cherry says no, squash provenance
// (squash-provenance.js, #2252: the confirmed PR's own mergeCommit oid on
// the bounded first-parent history — what `gh pr merge --squash` leaves).
// Anything weaker — no PR, a closed unmerged PR, a proof without a merged
// PR — skips, keeping today's staged-in-tidy path for the ambiguous cases. Scope is the plugin-owned namespaces (the
// scope patterns behind `inScope`, reused from archive-branches.js), and a
// branch attached to a live worktree is silently out of scope (same
// inScope guard).
//
// The check FETCHES AND PRUNES origin first, before it enumerates anything
// (unless `skipFetch` says a caller already did — reconcile()'s shared
// fetch, shared-fetch.js, #820 D2): the cherry-equivalence evidence is
// computed against local `refs/remotes/origin/*` snapshots, but the
// deletion acts on origin's LIVE ref and git offers no --force-with-lease
// for `push --delete`. Without the refresh, a branch another clone has
// pushed to since our last fetch still reads merged here, and the delete
// destroys commits this checkout never saw. A fetch failure therefore skips
// the WHOLE check (`fetch-failed`) — fail closed, never delete on stale
// evidence. The `--prune` half also drops tracking refs for branches
// already gone on origin, so those stop being re-examined (and
// re-`gh`-queried) on every run.
// Pure decision function with I/O at the edges, matching the family.
'use strict';

const { execFileSync } = require('child_process');
const { runGit, DEFAULT_TIMEOUT_MS } = require('../hooks/git-exec');
const { parseWorktreeList } = require('../hooks/worktree-reap');
const { inScope, isCherryEquivalent } = require('./archive-branches');
const { resolvePrState, resolvePrStatesBulk } = require('./pr-state');
const { isSquashMerged } = require('./squash-provenance');

// -> true (ref exists), false (provably gone — `ls-remote --exit-code`
// exits 2), or null (indeterminate: network/timeout/any other failure).
// Deliberately NOT runGit — runGit's failure classification collapses every
// non-zero exit to one `git-error` kind and discards stderr/exit status
// (git-exec.js's own stdio: [.., .., 'ignore']), which can't tell "ref not
// found" (exit 2, the one case that should read as success below) apart
// from "ls-remote itself failed" (any other exit — must never be read as
// success, or a real failure gets misreported as a completed delete).
function defaultRefExists(root, branch, timeoutMs) {
  try {
    execFileSync('git', ['-C', root, 'ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`], {
      stdio: 'ignore', timeout: timeoutMs, windowsHide: true,
    });
    return true;
  } catch (e) {
    return e && e.status === 2 ? false : null;
  }
}

// One remote branch's evidence -> what to do. Pure — no I/O.
//   { action: 'delete' | 'skip', reason }
// squashMerged (#2252) is the second proof, consulted only where
// cherryEquivalent is false; the screen's provisional call omits it.
function decideRemotePrune({ branch, cherryEquivalent, squashMerged = false, prState }) {
  if (prState === 'gh-absent' || prState === 'network-failure') {
    return { action: 'skip', reason: prState }; // evidence unknown — fail closed
  }
  if (prState && prState.state === 'OPEN') {
    return { action: 'skip', reason: 'pr-open' }; // work may still be landing
  }
  if (!cherryEquivalent && !squashMerged) {
    return { action: 'skip', reason: 'not-proven-merged' }; // neither proof — content not proven merged
  }
  if (!prState || prState.state !== 'MERGED') {
    return { action: 'skip', reason: 'no-merged-pr' }; // a proof alone is not enough for a pushed delete
  }
  return { action: 'delete', reason: cherryEquivalent ? 'merged-pr-cherry-equivalent' : 'merged-pr-squash-merged' };
}

function pruneRemote({ cwd, integration, dryRun, resolvePr, resolvePrBulk, skipFetch, refExists } = {}) {
  const root = cwd || process.cwd();
  const resolve = resolvePr || resolvePrState;
  const resolveBulk = resolvePrBulk || resolvePrStatesBulk;
  const checkRefExists = refExists || ((r, b) => defaultRefExists(r, b, DEFAULT_TIMEOUT_MS));
  const entries = [];

  // First, before any ref is read: every verdict below is computed from
  // refs/remotes/origin/*, so refreshing them is a precondition of the check,
  // not a step of it. skipFetch lets a caller that already ran the identical
  // `git fetch --prune origin` this pass (reconcile()'s shared fetch,
  // shared-fetch.js, #820 D2) skip the redundant round trip.
  if (!skipFetch) {
    const fetched = runGit(['fetch', '--prune', 'origin'], root);
    if (fetched.failure) return { entries, failure: 'fetch-failed' };
  }

  const wtList = runGit(['worktree', 'list', '--porcelain'], root);
  if (wtList.failure) return { entries, failure: 'git-failure' };
  const worktrees = parseWorktreeList(wtList.stdout);

  // lstrip=3 strips exactly refs/remotes/origin/, leaving the symbolic HEAD
  // ref as the bare string 'HEAD' — refname:short instead yields 'origin'
  // for that ref (no slash), which the branch === 'HEAD' guard below would
  // never match.
  const refs = runGit(['for-each-ref', '--format=%(refname:lstrip=3)', 'refs/remotes/origin'], root);
  if (refs.failure) return { entries, failure: 'git-failure' };

  // Collect the in-scope branch set first — the screen is one bulk call.
  const inScopeBranches = [];
  for (const branch of refs.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    if (branch === 'HEAD' || branch === integration) continue;
    if (!inScope(branch, worktrees)) continue;
    inScopeBranches.push(branch);
  }

  // Screen (#1082): one chunked GraphQL call for the whole set, destructive
  // tie-break applied (#664 — any OPEN PR governs). ALL-OR-NOTHING: a failed
  // screen skips the whole check, same fail-closed shape as fetch-failed.
  const screen = inScopeBranches.length > 0
    ? resolveBulk(root, inScopeBranches, { preferOpen: true })
    : new Map();
  if (screen === 'gh-absent') return { entries, failure: 'gh-absent' };
  if (screen === 'network-failure') return { entries, failure: 'pr-screen-failed' };

  const toDelete = [];
  for (const branch of inScopeBranches) {
    // Provisional verdict on screen evidence, through the UNCHANGED decision
    // table. cherryEquivalent: true is a documented sentinel — safe because
    // decideRemotePrune checks OPEN before cherry (order pinned by test) and
    // cherry only gates the delete direction, which never happens without
    // the per-branch confirm below. Screen evidence alone can only skip.
    const provisional = decideRemotePrune({ branch, cherryEquivalent: true, prState: screen.get(branch) || null });
    if (provisional.action === 'skip') {
      entries.push({ name: branch, kind: 'remote-branch', action: 'skip', reason: provisional.reason });
      continue;
    }
    // Candidate (screen said MERGED): today's exact per-branch evidence.
    const cherryEquivalent = isCherryEquivalent(root, integration, `origin/${branch}`);
    if (cherryEquivalent === null) {
      entries.push({ name: branch, kind: 'remote-branch', action: 'skip', reason: 'cherry-failed' });
      continue;
    }
    // Confirm runs under dryRun too — reported reasons are confirmed reasons.
    const prState = resolve(root, branch, { preferOpen: true });
    // Second proof (#2252), only when cherry could not prove it: the confirm
    // is what carries mergeCommit, so it must precede this call.
    const squashMerged = cherryEquivalent ? false : isSquashMerged(root, integration, `origin/${branch}`, prState);
    const decision = decideRemotePrune({ branch, cherryEquivalent, squashMerged, prState });
    if (decision.action === 'skip' || dryRun) {
      entries.push({ name: branch, kind: 'remote-branch', action: decision.action, reason: decision.reason });
      continue;
    }
    toDelete.push({ branch, reason: decision.reason });
  }

  if (toDelete.length === 0) return { entries, failure: null };

  // One batched delete for every branch decided `delete` this pass — was one
  // `push --delete` per branch, now the family's single pushed mutation
  // (#820, D3).
  const batch = runGit(['push', 'origin', '--delete', ...toDelete.map((d) => d.branch)], root);
  if (!batch.failure) {
    for (const { branch, reason } of toDelete) {
      entries.push({ name: branch, kind: 'remote-branch', action: 'delete', reason });
    }
    return { entries, failure: null };
  }

  // Batch push failed (e.g. one ref already gone on origin) — fall back to
  // per-branch pushes so one bad ref doesn't silently swallow every other
  // deletion this pass would otherwise have made.
  for (const { branch, reason } of toDelete) {
    const del = runGit(['push', 'origin', '--delete', branch], root);
    if (!del.failure) {
      entries.push({ name: branch, kind: 'remote-branch', action: 'delete', reason });
      continue;
    }
    // The individual push can fail because THIS branch was already deleted
    // (by the batch push above despite its overall nonzero exit, or by a
    // concurrent reconcile pass) — check before reporting delete-failed, so
    // an already-gone branch isn't misreported as a failure (review
    // finding). Only a provable "ref not found" (checkRefExists === false)
    // counts as success; an indeterminate check (null) stays delete-failed —
    // fail toward the existing, safer classification on any ambiguity.
    entries.push(checkRefExists(root, branch) === false
      ? { name: branch, kind: 'remote-branch', action: 'delete', reason }
      : { name: branch, kind: 'remote-branch', action: 'skip', reason: 'delete-failed' });
  }
  return { entries, failure: null };
}

module.exports = { decideRemotePrune, pruneRemote, defaultRefExists };
