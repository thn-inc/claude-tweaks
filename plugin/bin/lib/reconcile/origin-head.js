// bin/lib/reconcile/origin-head.js — one-time origin/HEAD repair for a
// fresh clone (#3132). A brand-new clone in a cloud/Routine sandbox can
// lack the local refs/remotes/origin/HEAD symbolic ref, which leaves
// worktree-reap.js's offline resolveIntegrationBranch with nothing to read
// and reconcile skipping every check as `no-remote`. The repair lives here,
// at the one consumer that already does network work (shared-fetch.js),
// rather than in the shared resolver: that resolver is called from the
// pre/post-tool-use hook paths and must stay offline and cheap.
//
// Never throws — every failure (no network, auth failure, unreachable
// remote) comes back as a value the caller degrades to the existing
// `no-remote` skip, per the never-break-a-session invariant (docs/hooks.md).
'use strict';
const { runGit: defaultRunGit } = require('../hooks/git-exec');
const { FETCH_TIMEOUT_MS } = require('./classify');

// -> null                                  no `origin` remote; nothing attempted
// -> { outcome: 'repaired' }               set-head wrote refs/remotes/origin/HEAD
// -> { outcome: 'failed', reason: string } set-head failed; reason is git-exec's FAILURE class
function repairOriginHead(root, opts = {}) {
  const runGit = opts.runGit || defaultRunGit;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : FETCH_TIMEOUT_MS;
  try {
    const remote = runGit(['remote', 'get-url', 'origin'], root);
    if (remote.failure) return null;
    const set = runGit(['remote', 'set-head', 'origin', '--auto'], root, { timeoutMs });
    if (set.failure) return { outcome: 'failed', reason: String(set.failure) };
    return { outcome: 'repaired' };
  } catch (e) {
    return { outcome: 'failed', reason: (e && e.message) || 'threw' };
  }
}

module.exports = { repairOriginHead };
