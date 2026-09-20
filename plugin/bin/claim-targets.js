#!/usr/bin/env node
// bin/claim-targets.js — group-claim CLI on the shared claim store.
//   node bin/claim-targets.js --run-id <id> --targets <n,n,...> [--keep-going] [--help]
// Exit 0 = all claimed (or, with --keep-going, partial); 2 = malformed
// invocation or missing dependency; 3 = contested, or a pr-opened tombstone
// whose linked PR is still open (JSON on stdout — {contested:[...]} or
// {inFlight:[{issue,link}]}); 4 = transient gh failure; 5 = a claim write
// reported success but the post-write read-back did not confirm it
// ({unverified:[{issue}]}). See bin/lib/claim-targets/claim-targets.js for
// the full contract and skills/_shared/issue-claims.md for the protocol.
'use strict';

const os = require('os');
const { execFileSync } = require('child_process');
const claimStore = require('./lib/issues/claim-store');
const { run } = require('./lib/claim-targets/claim-targets');
const { defaultRunner: gitDefaultRunner } = require('./lib/issues/claims-git-cas');
const { GH_TIMEOUT_MS } = require('./lib/shared-primitives');

function defaultGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS,
  });
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
};

// `realDeps` is exported so the CLI's own wiring is testable — specifically
// that `gitRunner` is the real claims-git-cas runner and not silently dropped
// (a drop degrades every claim write back to the contents API without failing
// anything). Same reason bin/release-claim.js exports its own. Tests inject
// their own deps into `run` and never use this object.
module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
