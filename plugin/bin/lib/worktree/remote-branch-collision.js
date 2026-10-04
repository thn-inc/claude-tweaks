// bin/lib/worktree/remote-branch-collision.js — classifies a same-name branch
// on `origin` for a run that ADOPTED its worktree instead of creating one
// (#2844).
//
// `build/worktree-setup.md` Step 1.6 (Remote-only stale branch check) runs
// only on the creation path, before `EnterWorktree`. A run that arrives
// already inside a worktree — a dispatched group, a multi-spec shared
// worktree, an interactive session's adopted worktree — skips Steps 1-3, so
// nothing probed `origin` for the adopted branch's name before the PR-early
// push, and an unrelated stale branch surfaced only as a non-fast-forward
// rejection. This module is the adopt-path counterpart.
//
// Step 1.6 can treat any remote ref as a collision because its precondition
// is "no local branch of this name exists yet". The adopt path cannot: the
// local branch exists and may legitimately already be on origin (this run's
// own earlier push — a resumed build, or records 2..N of a multi-spec run).
// Ancestry is the mechanical distinction: a remote tip contained in local
// HEAD is this branch's own history and a push fast-forwards it; a remote
// tip that is not contained would reject the push.
'use strict';

const { execFileSync } = require('child_process');
const { GH_TIMEOUT_MS } = require('../shared-primitives');

// Throws on a non-zero exit; the thrown error carries `.status`.
function defaultGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
}

function defaultGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', timeout: GH_TIMEOUT_MS });
}

const SHA_RE = /^[0-9a-f]{40,64}$/;

// A branch name this module will put into a `refs/heads/...` argument. Rejects
// anything that could not be a branch anyway, so a malformed name degrades to
// `unreachable` rather than reaching git.
function isSafeBranchName(branch) {
  return typeof branch === 'string'
    && branch.length > 0
    && !branch.startsWith('-')
    && !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(branch)
    && !branch.includes('..');
}

// Reads origin's tip for exactly `refs/heads/{branch}`. The full ref is passed
// (never the bare name) because `ls-remote` tail-matches a bare pattern, so
// `x` would also match `refs/heads/team/x`; the output is filtered on the
// exact ref for the same reason.
function readRemoteTip({ branch, git }) {
  const ref = `refs/heads/${branch}`;
  let out;
  try {
    out = git(['ls-remote', '--heads', 'origin', ref]);
  } catch (err) {
    return { ok: false, error: err };
  }
  for (const line of String(out).split('\n')) {
    const [sha, name] = line.trim().split(/\s+/);
    if (name === ref && SHA_RE.test(sha || '')) return { ok: true, sha };
  }
  return { ok: true, sha: null };
}

// `git merge-base --is-ancestor` exits 0 (ancestor), 1 (not an ancestor), or
// something else (typically 128 — the object is not in this repository).
function isAncestorOfHead({ sha, git }) {
  try {
    git(['merge-base', '--is-ancestor', sha, 'HEAD']);
    return { known: true, ancestor: true };
  } catch (err) {
    if (err && err.status === 1) return { known: true, ancestor: false };
    return { known: false, error: err };
  }
}

// Returns one of:
//   { state: 'absent' }                       — no such branch on origin; push creates it
//   { state: 'mine', remoteSha }              — origin's tip is in local HEAD's history (resume)
//   { state: 'foreign', remoteSha }           — origin's tip is NOT in local HEAD's history
//   { state: 'unreachable', reason, error }   — could not determine; caller fails open
//
// `unreachable` is never folded into `absent`: "could not look" and "looked,
// nothing there" must stay distinguishable in the caller's log.
function classifyRemoteBranch({ branch, git = defaultGit }) {
  if (!isSafeBranchName(branch)) {
    return { state: 'unreachable', reason: 'invalid-branch-name' };
  }

  const tip = readRemoteTip({ branch, git });
  if (!tip.ok) return { state: 'unreachable', reason: 'ls-remote-failed', error: tip.error };
  if (!tip.sha) return { state: 'absent' };

  let verdict = isAncestorOfHead({ sha: tip.sha, git });
  if (!verdict.known) {
    // The remote tip is not in the local object store. Fetch it and ask again
    // — only then is "not an ancestor" a fact rather than a guess.
    try {
      git(['fetch', 'origin', `refs/heads/${branch}`]);
    } catch (err) {
      return { state: 'unreachable', reason: 'fetch-failed', remoteSha: tip.sha, error: err };
    }
    verdict = isAncestorOfHead({ sha: tip.sha, git });
    if (!verdict.known) {
      return {
        state: 'unreachable', reason: 'ancestry-check-failed', remoteSha: tip.sha, error: verdict.error,
      };
    }
  }

  return { state: verdict.ancestor ? 'mine' : 'foreign', remoteSha: tip.sha };
}

// Best-effort PR context for the stop card. A failed lookup is `ok: false` —
// rendered as "PR status unknown", distinct from a confirmed empty result.
function findPrsForBranch({ branch, repo, gh = defaultGh }) {
  try {
    const out = gh([
      'pr', 'list', '--repo', repo, '--head', branch, '--state', 'all',
      '--json', 'number,url,state,isDraft',
    ]);
    return { ok: true, prs: JSON.parse(out || '[]') };
  } catch (err) {
    return { ok: false, error: err, prs: [] };
  }
}

function describePrs(prLookup) {
  if (!prLookup || !prLookup.ok) return 'PR status unknown (lookup failed)';
  if (prLookup.prs.length === 0) return 'no PR found for it';
  return prLookup.prs
    .map((pr) => `${String(pr.state || '').toLowerCase()} PR #${pr.number} (${pr.url})`)
    .join(', ');
}

function formatStopCard({ branch, remoteSha, prLookup }) {
  const short = String(remoteSha || '').slice(0, 9);
  return [
    '## Build: Adopted branch collides with an unrelated branch on origin',
    '',
    `\`${branch}\` already exists on \`origin\` at \`${short}\`, and that commit is not in this ` +
      `worktree's history — ${describePrs(prLookup)}. Pushing this branch would be rejected ` +
      'non-fast-forward.',
    '',
    `Options: (1) rename this worktree's local branch (\`git branch -m ${branch}-{suffix}\`) and ` +
      're-run, (2) delete the stale remote branch ' +
      `(\`git push origin --delete ${branch}\`) and re-run, (3) stop and resume the existing ` +
      'remote branch/PR instead.',
  ].join('\n');
}

module.exports = {
  isSafeBranchName,
  readRemoteTip,
  classifyRemoteBranch,
  findPrsForBranch,
  formatStopCard,
};
