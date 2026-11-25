'use strict';
// bin/lib/run-liveness/facts.js — gathers the inputs disposition.js judges a
// run directory on (#3977): PR state, branch and worktree facts, staged
// inventory, and how long the run has been quiet. Every probe that fails maps
// to the "cannot determine" value (`pr: 'unknown'`, a `null` fact) — never to a
// value that closes. The liveness verdict is not gathered here: reconcile
// computes it once per run and passes it to disposition() beside these facts.
const path = require('path');
const { runGit, repoPinnedEnv } = require('../hooks/git-exec');
const { lstatType } = require('../path-guard');
const { ownEventRecency } = require('./probes');
const { runIdMs } = require('./index');
const { shapeOf } = require('./disposition');

function defaultGit(args, cwd) {
  return runGit(args, cwd, { env: repoPinnedEnv() });
}

// Lazy: archive-merged.js requires this module's siblings, and only reconcile
// (which has already loaded it) calls this default.
function defaultListStaged(dir) {
  return require('../reconcile/archive-merged').listStagedItems(dir);
}

const UNKNOWN_BRANCH = Object.freeze({ name: null, localExists: null, remoteExists: null, uniqueCommits: null });

// A resolvePrState / resolvePrStateByNumber answer -> { pr, prNumber, prDraft }.
// `null` is GitHub's "no PR"; any failure string, and `undefined` (not looked
// up at all), is unknown.
function prFact(prState) {
  if (prState === null) return { pr: 'none', prNumber: null, prDraft: null };
  if (!prState || typeof prState !== 'object') return { pr: 'unknown', prNumber: null, prDraft: null };
  const prNumber = Number.isInteger(prState.number) ? prState.number : null;
  const prDraft = prState.isDraft === true;
  if (prState.state === 'MERGED') return { pr: 'merged', prNumber, prDraft };
  if (prState.state === 'CLOSED') return { pr: 'closed-unmerged', prNumber, prDraft };
  if (prState.state === 'OPEN') return { pr: 'open', prNumber, prDraft };
  return { pr: 'unknown', prNumber, prDraft: null };
}

// true / false for a ref that provably exists / does not; null when git could
// not answer. `rev-parse --verify --quiet` exits 1 with no output for a missing ref.
function refExists(git, root, ref) {
  const r = git(['rev-parse', '--verify', '--quiet', ref], root);
  if (!r.failure) return true;
  if (r.exitCode === 1 && !String(r.stderr || '').trim()) return false;
  return null;
}

function branchFact(git, root, name, integration) {
  if (typeof name !== 'string' || !name) return { ...UNKNOWN_BRANCH };
  const localExists = refExists(git, root, `refs/heads/${name}`);
  const remoteExists = refExists(git, root, `refs/remotes/origin/${name}`);
  let uniqueCommits = null;
  if (localExists === false && remoteExists === false) {
    uniqueCommits = 0;
  } else if (localExists === true && typeof integration === 'string' && integration) {
    // The remote-tracking integration ref when there is one (a checkout with no
    // origin, or one never fetched, falls back to the local integration branch).
    let base = null;
    if (refExists(git, root, `refs/remotes/origin/${integration}`) === true) base = `refs/remotes/origin/${integration}`;
    else if (refExists(git, root, `refs/heads/${integration}`) === true) base = `refs/heads/${integration}`;
    if (!base) return { name, localExists, remoteExists, uniqueCommits: null };
    const r = git(['rev-list', '--count', `${base}..refs/heads/${name}`], root);
    const n = r.failure ? NaN : Number(String(r.stdout || '').trim());
    uniqueCommits = Number.isInteger(n) && n >= 0 ? n : null;
  }
  return { name, localExists, remoteExists, uniqueCommits };
}

function worktreeFact(git, state) {
  const wt = state && typeof state.worktree === 'string' && state.worktree ? state.worktree : null;
  if (!wt) return { path: null, exists: false, dirty: false };
  const t = lstatType(wt);
  if (t.type === 'missing') return { path: wt, exists: false, dirty: false };
  if (t.type !== 'directory' && t.type !== 'symlink') return { path: wt, exists: null, dirty: null };
  const r = git(['--no-optional-locks', 'status', '--porcelain'], wt); // git-path-read: not a path list (emptiness only)
  if (r.failure) return { path: wt, exists: true, dirty: null };
  return { path: wt, exists: true, dirty: String(r.stdout || '').trim().length > 0 };
}

function quietFact(dir, now) {
  const { readable, lastOwnMs } = ownEventRecency(dir);
  if (!readable) return null;
  const ref = lastOwnMs !== null && lastOwnMs !== undefined ? lastOwnMs : runIdMs(dir);
  return ref === null || !Number.isFinite(ref) ? null : now - ref;
}

const ALL_UNKNOWN = (dir) => ({
  shape: shapeOf(dir),
  pr: 'unknown',
  prNumber: null,
  prDraft: null,
  branch: { ...UNKNOWN_BRANCH },
  worktree: { path: null, exists: null, dirty: null },
  staged: null,
  quietMs: null,
});

// -> the disposition() input minus `verdict`. Never throws.
function gatherFacts({ root, dir, state, branch, integration, prState, now = Date.now(), deps = {} } = {}) {
  try {
    const git = deps.git || defaultGit;
    const listStaged = deps.listStaged || defaultListStaged;
    return {
      shape: shapeOf(dir),
      ...prFact(prState),
      branch: branchFact(git, root || path.resolve(dir, '..', '..', '..'), branch, integration),
      worktree: worktreeFact(git, state),
      staged: listStaged(dir),
      quietMs: quietFact(dir, now),
    };
  } catch {
    return ALL_UNKNOWN(dir);
  }
}

module.exports = { gatherFacts, prFact };
