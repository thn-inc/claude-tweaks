#!/usr/bin/env node
// bin/claim-targets.js — group-claim CLI on the shared claim store.
//   node bin/claim-targets.js --run-id <id> --targets <n,n,...> [--keep-going] [--run <run-dir>] [--steps <step,step,...>] [--resume-pr <url>] [--help]
// --steps with neither build nor test claims nothing (skipGuard: no-build-or-test).
// --resume-pr re-claims a stale claim whose in-flight PR is exactly <url> (dispatch resume, #4588).
// Exit 0 = all claimed (or, with --keep-going, partial; or skip-guarded); 2 = malformed
// invocation or missing dependency (an origin host the origin-host gate refuses,
// `unknown-host`, included); 3 = contested, or in flight — a pr-opened
// tombstone whose linked PR is still open, or a stale claim whose run marker
// sits on an open same-repo PR (JSON on stdout — {contested:[...]} or
// {inFlight:[{issue,link}]}); 4 = transient gh failure (a claims-registry
// bootstrap network failure or rate limit included); 5 = a claim write
// reported success but the post-write read-back did not confirm it
// ({unverified:[{issue}]}); 6 = the claims-registry branch is missing on origin
// and creating it was refused ({branchMissing:{branch,reason}}, with or without
// --keep-going); 7 = GitHub refused a claim read or write
// ({permissionDenied:{issue,operation,reason}}, with or without --keep-going).
// See bin/lib/claim-targets/claim-targets.js for
// the full contract and skills/_shared/issue-claims.md for the protocol.
'use strict';

const os = require('os');
const { execFileSync } = require('child_process');
const claimStore = require('./lib/issues/claim-store');
const { run, defaultAppendClaimLog } = require('./lib/claim-targets/claim-targets');
const { defaultRunner: gitDefaultRunner } = require('./lib/issues/claims-git-cas');
const { GH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
const {
  ghOptions, resolveRepoTarget, resolveGhHost, gateOriginRepo, originUrl,
} = require('./lib/repo-resolve');

// maxBuffer: the stale-claim check's `gh pr list --json url,body,...` carries
// every open PR's body, which overflows Node's 1 MiB default (ENOBUFS) well
// before its 1000-PR limit.
function defaultGh(args) {
  return execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS,
    maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true,
  }));
}

const realDeps = {
  ghApi: claimStore.defaultGhApi,
  gh: defaultGh,
  gitRunner: gitDefaultRunner,
  now: Date.now,
  stdout: (s) => process.stdout.write(`${s}\n`),
  stderr: (s) => process.stderr.write(s),
  hostname: os.hostname(),
  sessionId: process.env.CLAUDE_CODE_SESSION_ID || '',
  appendClaimLog: defaultAppendClaimLog,
  // #4794: the origin-host gate's verdict ({ spec, refusal }), for run() to refuse an
  // unknown or SSH-alias origin before any gh call. `originUrl` carries the git timeout.
  gateOrigin: () => {
    let remote = null;
    try { remote = originUrl(process.cwd()); } catch { remote = null; }
    return gateOriginRepo(remote);
  },
  // #4794: the run's one repo target. The host is the gh seam's (`resolveGhHost`, positive
  // signals only): the one `defaultGh`'s inferred calls (`gh repo view`, `gh pr view`) already
  // reach, so the stale listing, the tombstone check and the stale match share it. For an
  // admitted origin it equals the gate's host (both read `hostPathOf`).
  repoTarget: (owner, repo) => resolveRepoTarget({ owner, repo, originHost: resolveGhHost(process.cwd()) }),
};

// `realDeps` is exported so the CLI's own wiring is testable — specifically
// that `gitRunner` is the real claims-git-cas runner and not silently dropped
// (a drop degrades every claim write back to the contents API without failing
// anything). Same reason bin/release-claim.js exports its own. Tests inject
// their own deps into `run` and never use this object.
module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
