// bin/lib/reconcile/shared-fetch.js — the one `git fetch` reconcile()
// performs per pass, shared by mirror (classify.js) and prune-remote.js,
// which each previously ran their own separate fetch (#820, D2).
//
// The fetch SHAPE is chosen by which of {mirror, remote-prune} this pass
// actually requested, not by one fixed shape for every caller (#820 final
// review). The two checks are provably disjoint today — session-start.js's
// FAST_CHECKS carries mirror, bin/hooks.js's BACKGROUND_CHECKS carries
// remote-prune, and tests/bin-lib/hooks/reconcile-background.test.js pins
// that partition — so each process now pays only for the fetch its own
// checks need:
//
//   remote-prune requested -> `git fetch --prune origin`, deliberately with
//     NO explicit timeoutMs. --prune (broader than mirror's single-ref
//     fetch) also drops stale tracking refs for branches already gone on
//     origin, so prune-remote stops re-examining them every pass.
//     prune-remote.js's own (now removed) fetch never passed a timeout
//     either, so it falls back to git-exec's DEFAULT_TIMEOUT_MS (10000ms) in
//     production and keeps honoring the CT_HOOKS_GIT_TIMEOUT_MS test-load
//     escape hatch — an explicit opts.timeoutMs would short-circuit that
//     hatch entirely (see resolveTimeout in git-exec.js).
//
//   mirror only -> `git fetch origin {integration}` under classify.js's own
//     FETCH_TIMEOUT_MS. This is session-start's inline hot path and, since
//     #4032, the unscoped `hooks.js reconcile` CLI's too (its inline set
//     defers remote-prune to the background pass, so other
//     refs/remotes/origin/* refs refresh only when that pass's --prune fetch
//     runs) — where a slow
//     remote must not stall the caller for the full general budget — exactly
//     the rationale classify.js's constant documents, and applicable again
//     now that this fetch is no longer also serving remote-prune in the same
//     process.
//
//   both -> the `--prune` shape, the superset that safely serves both. Not
//     reachable under today's partition, but a future check reshuffle could
//     reintroduce it: widening mirror's fetch costs a little extra work,
//     whereas shrinking remote-prune's budget would silently break it.
//
// reconcile()'s own overall wall-clock budget (~18s, #820 D4) stays the
// backstop against a pathologically slow fetch under either shape.
'use strict';
const { runGit, runGitAsync } = require('../hooks/git-exec');
const { FETCH_TIMEOUT_MS } = require('./classify');

// opts: { integration: string, mirror?: boolean, remotePrune?: boolean }
function sharedFetch(root, opts = {}) {
  if (opts.mirror && !opts.remotePrune) {
    return runGit(['fetch', 'origin', opts.integration], root, { timeoutMs: FETCH_TIMEOUT_MS });
  }
  return runGit(['fetch', '--prune', 'origin'], root);
}

// Async, mirror-only twin of sharedFetch — used by reconcile/index.js's
// FAST_CHECKS dispatch (mirror requested, remote-prune not — the "mirror
// only" shape documented above), which runs this concurrently with
// ghHealthCheckAsync via Promise.all instead of paying for both serially
// (#872). No --prune branch: the remote-prune and mirror+remote-prune
// shapes stay on the sync sharedFetch above, unchanged — this twin exists
// solely for the one shape that actually needs to run concurrently with the
// preflight.
async function sharedFetchAsync(root, opts = {}) {
  return runGitAsync(['fetch', 'origin', opts.integration], root, { timeoutMs: FETCH_TIMEOUT_MS });
}

module.exports = { sharedFetch, sharedFetchAsync };
