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
const { readCache, writeCache, isFresh, DEFAULT_TTL_MS } = require('./cache');

// -> null                                            no `origin` remote; nothing attempted
// -> { outcome: 'repaired' }                         set-head wrote refs/remotes/origin/HEAD
// -> { outcome: 'failed', reason: string }           set-head failed; reason is git's first stderr line, else git-exec's FAILURE class
// -> { outcome: 'skipped', reason: 'recent-failure' } a prior set-head failed within DEFAULT_TTL_MS; not retried this pass
// -> { outcome: 'skipped', reason: 'dry-run' }        `opts.dryRun`: set-head (a ref write) and the failure stamp (a cache write) are never attempted (#4180)
function repairOriginHead(root, opts = {}) {
  const runGit = opts.runGit || defaultRunGit;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : FETCH_TIMEOUT_MS;
  const now = opts.now != null ? opts.now : Date.now();
  // writeCache is best-effort and never throws, so this is safe on every
  // failure path, the catch below included.
  const rememberFailure = () => writeCache(root, { ...readCache(root), lastOriginHeadRepairFailedAt: now });
  try {
    const remote = runGit(['remote', 'get-url', 'origin'], root);
    if (remote.failure) return null;
    // #4180: a dry run writes neither a ref nor the cache. Checked after the read-only remote
    // probe so a checkout with no `origin` still reports nothing, as before.
    if (opts.dryRun) return { outcome: 'skipped', reason: 'dry-run' };
    // #3132 follow-up: a failed set-head (offline, auth reject, a remote
    // that silently drops traffic) otherwise re-runs on every pass — up to
    // FETCH_TIMEOUT_MS each — since the no-remote path below returns before
    // reconcile ever stamps `lastRunAt`, so skipIfFresh never short-circuits
    // it. Remember the failure for DEFAULT_TTL_MS instead of retrying blind.
    if (isFresh(readCache(root), now, DEFAULT_TTL_MS, 'lastOriginHeadRepairFailedAt')) {
      return { outcome: 'skipped', reason: 'recent-failure' };
    }
    const set = runGit(['remote', 'set-head', 'origin', '--auto'], root, { timeoutMs });
    if (set.failure) {
      rememberFailure();
      // git's own message (auth reject, unreachable host) is what an operator
      // in a sandbox needs; the FAILURE class alone is just `git-error`.
      const stderrLine = set.stderr ? set.stderr.split('\n')[0].trim() : '';
      return { outcome: 'failed', reason: stderrLine || String(set.failure) };
    }
    return { outcome: 'repaired' };
  } catch (e) {
    rememberFailure();
    return { outcome: 'failed', reason: (e && e.message) || 'threw' };
  }
}

module.exports = { repairOriginHead };
