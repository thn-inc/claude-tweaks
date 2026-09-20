// bin/lib/wrap-up/state.js — read the repository facts the wrap-up State block
// asserts, so they are measured rather than recalled.
//
// Every field is present on the returned object even when unknown (null). A
// field that disappears when it cannot be determined reads as an absent fact
// rather than an unknown one — which is how a report once claimed work had
// landed when it had only been committed locally.
'use strict';

const { execFileSync } = require('node:child_process');

function defaultRunner(cwd) {
  return (args) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
}

function toInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function readState({ cwd, since, run } = {}) {
  const git = run || defaultRunner(cwd);
  const base = {
    isRepo: false, branch: null, detachedAt: null, upstream: null,
    ahead: null, behind: null, pushed: false, commitsInScope: null, linkedWorktree: false,
    remoteRef: null, pushedVia: null,
  };
  if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') return base;

  const branchRaw = git(['branch', '--show-current']);
  const branch = branchRaw ? branchRaw : null;
  const detachedAt = branch ? null : git(['rev-parse', '--short', 'HEAD']);

  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);

  // The branch's own remote-tracking ref. Hard-coded to `origin` — the
  // pr-first lifecycle pushes to `origin` by contract
  // (`_shared/integration-branch.md`), so a remote named anything else is out
  // of scope. Detached HEAD (branch null) skips this probe entirely,
  // preserving today's detached-HEAD output — there is no branch name to
  // form a remote ref from.
  const originBranchRef = branch ? `origin/${branch}` : null;
  const remoteRefExists = Boolean(
    branch && git(['rev-parse', '--verify', '--quiet', '--end-of-options', `refs/remotes/${originBranchRef}`])
  );

  // `pushed` is always judged against exactly one ref, never both. A
  // configured upstream that already equals this branch's own origin ref
  // takes precedence and the remote-ref fallback is never consulted.
  // Otherwise, when the branch's own remote-tracking ref exists — whether
  // some OTHER upstream is configured (the #1860 inherited-upstream shape)
  // or none at all — judge from that ref instead, since `git push origin
  // {branch}` (no `-u`) updates it without ever touching `@{u}`.
  let judgeRef = null;
  let pushedVia = null;
  if (upstream && upstream === originBranchRef) {
    judgeRef = '@{u}';
    pushedVia = 'upstream';
  } else if (remoteRefExists) {
    judgeRef = originBranchRef;
    pushedVia = 'remote-ref';
  } else if (upstream) {
    judgeRef = '@{u}';
    pushedVia = 'upstream';
  }

  let ahead = null;
  let behind = null;
  if (judgeRef) {
    // `--left-right --count {ref}...HEAD`: left is ref-only (behind), right
    // is local-only (ahead).
    const counts = git(['rev-list', '--left-right', '--count', `${judgeRef}...HEAD`]);
    if (counts) {
      const [b, a] = counts.split(/\s+/);
      behind = toInt(b);
      ahead = toInt(a);
    }
  }

  const commitsInScope = since ? toInt(git(['rev-list', '--count', `${since}..HEAD`])) : null;
  const gitDir = git(['rev-parse', '--git-dir']);
  const commonDir = git(['rev-parse', '--git-common-dir']);

  return {
    isRepo: true,
    branch,
    detachedAt: detachedAt || null,
    upstream: upstream || null,
    ahead,
    behind,
    // Pushed requires a chosen ref (upstream or the remote-ref fallback) AND
    // nothing ahead of it. No ref at all — no upstream configured and no
    // origin/{branch} remote-tracking ref — means there is nowhere for the
    // work to have gone, so it is unpushed, not unknown. But WITH a chosen
    // ref, a failed ahead/behind read must stay null rather than collapse to
    // a definite false — an unmeasured push state is exactly the unknown
    // this module exists to keep representable.
    pushed: judgeRef ? (ahead === null ? null : ahead === 0) : false,
    commitsInScope,
    linkedWorktree: Boolean(gitDir && commonDir && gitDir !== commonDir),
    remoteRef: pushedVia === 'remote-ref' ? originBranchRef : null,
    pushedVia,
  };
}

module.exports = { readState };
