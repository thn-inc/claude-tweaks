#!/usr/bin/env node
// bin/resolve-linked-prs.js — single-invocation CLI wrapping
// bin/lib/issues/record.js's buildLinkedPRQuery and the GraphQL call it
// produces (bin/lib/issues/linked-prs.js's fetchLinkedPRs) behind one shell
// command. Built on bin/lib/number-list-cli.js's shared scaffold — the
// shared parseNumbers/parseArgs/realDeps/exit-code machinery it shares
// byte-for-byte with bin/resolve-blockers.js (#1981) lives there now.
// Exists for the same reason resolve-blockers.js does — a worktree-isolated
// session's compound-Bash refusal on hand-rolling `gh api graphql` with
// bound variables — for the open-linked-PR exclusion check (#1224). Zero
// runtime npm deps.
//
// Usage: resolve-linked-prs.js <n>[,<n2>,...] [--repo owner/name] [--help]
// A comma-joined list (no spaces, mirroring resolve-blockers.js's own
// convention) batches every number into the ONE aliased GraphQL call
// fetchLinkedPRs makes for an N-record set — this CLI never issues more
// than one gh call regardless of how many numbers are passed.
// Output: one JSON line, an object keyed by each requested number (as a
// string, JSON's own key convention) to its {"openPR": number|null} — the
// same per-record shape fetchLinkedPRs' Map values already carry, not a new
// shape invented here. A single-number invocation still returns a one-key
// object — no special-cased flat shape — so every caller reads results the
// same way regardless of how many numbers it asked for. Exit 0 on success;
// 1 on a malformed invocation (missing/non-positive-integer number in the
// list, unknown flag); 2 when `gh` is absent or owner/repo cannot be
// resolved (no --repo and no readable origin remote); 3 when the GraphQL
// call itself throws (network/API failure, or fetchLinkedPRs' own
// partial-result guard). Repo root comes from `git remote get-url origin`
// at the process cwd — never from CLAUDE_PLUGIN_ROOT (unset in Bash tool
// environments, #170) — mirroring resolve-blockers.js's --repo override +
// remote-url fallback.
'use strict';

const { fetchLinkedPRs } = require('./lib/issues/linked-prs');
const { makeNumberListCli } = require('./lib/number-list-cli');

const USAGE = 'usage: resolve-linked-prs.js <n>[,<n2>,...] [--repo owner/name] [--help]\n';

const { run, parseArgs, parseNumbers, realDeps } = makeNumberListCli({
  name: 'resolve-linked-prs.js',
  usage: USAGE,
  // 30s bound: ONE GraphQL call for the whole aliased batch, whatever its
  // size — same precedent as resolve-blockers.js's own runner bound, since
  // this comma-list can span the same full ~200-record queues
  // queue-pull-script.md builds from `--limit 200`.
  runnerTimeoutMs: 30000,
  fetch: ({ numbers, owner, repo, runner }) => fetchLinkedPRs({ numbers, owner, repo, runner }),
  mapResult: (n, byNumber) => byNumber.get(n),
});

module.exports = { run, parseArgs, parseNumbers, parseRepo: require('./lib/repo-resolve').parseRepo };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
