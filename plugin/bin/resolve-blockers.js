#!/usr/bin/env node
// bin/resolve-blockers.js — single-invocation CLI wrapping
// bin/lib/issues/record.js's buildNativeDependencyQuery and the GraphQL
// call it produces (bin/lib/issues/native-dependencies.js's
// fetchNativeDependencies — the same function
// bin/lib/preflight-records/preflight-records.js calls for its own N-record
// batch) behind one shell command. Built on bin/lib/number-list-cli.js's
// shared scaffold — the shared parseNumbers/parseArgs/realDeps/exit-code
// machinery it shares byte-for-byte with bin/resolve-linked-prs.js (#1981)
// lives there now. Exists so a worktree-isolated session's compound-Bash
// refusal on hand-rolling `gh api graphql` with bound variables
// (skills/_shared/scratch-worktree.md's Shell constraint section) has a
// single-command escape hatch for the work-links: native blocked-by check
// (#538). Zero runtime npm deps.
//
// Usage: resolve-blockers.js <n>[,<n2>,...] [--repo owner/name] [--help]
// A comma-joined list (no spaces, mirroring this codebase's existing
// multi-spec-number convention — see flow/materialize.md's `#A,#B` form)
// batches every number into the ONE aliased GraphQL call
// fetchNativeDependencies already makes for an N-record set — this CLI
// never issues more than one gh call regardless of how many numbers are
// passed (#1174).
// Output: one JSON line, an object keyed by each requested number (as a
// string, JSON's own key convention) to its {"blockedBy":[...],
// "openBlocker":bool,"openBlockerIds":[...]} — the same per-record shape
// fetchNativeDependencies' Map values already carry (and preflight-records.js's
// buildRecords `dep` entries expose), not a new shape invented here. A
// single-number invocation still returns a one-key object — no special-cased
// flat shape — so every caller reads results the same way regardless of
// how many numbers it asked for. Exit 0 on success; 1 on a malformed
// invocation (missing/non-positive-integer number in the list, unknown
// flag); 2 when `gh` is absent or owner/repo cannot be resolved (no
// `--repo` and no readable `origin` remote); 3 when the GraphQL call itself
// throws (network/API failure, or fetchNativeDependencies' own
// partial-result guard). Repo root comes from `git remote get-url origin`
// at the process cwd — never from CLAUDE_PLUGIN_ROOT (unset in Bash tool
// environments, #170) — mirroring bin/materialize.js's --repo override +
// remote-url fallback.
'use strict';

const { fetchNativeDependencies } = require('./lib/issues/native-dependencies');
const { makeNumberListCli } = require('./lib/number-list-cli');

const USAGE = 'usage: resolve-blockers.js <n>[,<n2>,...] [--repo owner/name] [--help]\n';

const { run, parseArgs, parseNumbers, realDeps } = makeNumberListCli({
  name: 'resolve-blockers.js',
  usage: USAGE,
  // 30s bound: ONE GraphQL call for the whole aliased batch, whatever its
  // size — matches fetch-sub-issues.js's precedent for its own 50-alias
  // batch shape rather than #1154's 5s single-call default, since a
  // comma-list here can legitimately span the full ~200-record queues
  // unblocked-records.md/queue-pull-script.md build from `--limit 200`.
  runnerTimeoutMs: 30000,
  ghRequiredNote: '(work-links: native)',
  fetch: ({ numbers, owner, repo, runner }) => fetchNativeDependencies({ numbers, owner, repo, runner }),
  mapResult: (n, byNumber) => byNumber.get(n),
});

module.exports = { run, parseArgs, parseNumbers, parseRepo: require('./lib/repo-resolve').parseRepo };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
