#!/usr/bin/env node
// bin/resolve-foreign-blockers.js — single-invocation CLI wrapping
// bin/lib/issues/cross-repo-states.js's fetchCrossRepoStates: the state (OPEN / CLOSED) of
// blockers that live in ANOTHER repository, for the 'Blocked by owner/name#N' lines a record body
// declares (#4793). A native blockedBy node carries its own state; a body line does not. Built on
// bin/lib/number-list-cli.js's shared scaffold (its list is owner/name#N refs rather than numbers),
// so a worktree-isolated session's compound-Bash refusal on hand-rolling `gh api graphql` with bound
// variables has a single-command escape hatch here too. Zero runtime npm deps.
//
// Usage: resolve-foreign-blockers.js <owner/name#N>[,<owner/name#N2>,...] [--repo owner/name] [--help]
// A comma-joined list (no spaces) batches every ref into ONE aliased GraphQL call — never more than one
// gh call regardless of how many refs are passed. The list is deduplicated case-insensitively, keyed by
// the lowercased 'owner/name#N'. A ref whose number is above 2147483647 (GraphQL's Int ceiling) is
// accepted but never sent, and reads null — it never fails the other refs.
// Output: one JSON line, an object keyed by each distinct ref to "OPEN", "CLOSED" or null (unreadable:
// a missing, inaccessible or NOT_FOUND issue, an oversized number, or any other state string is NOT
// reported as CLOSED, so a caller blocking on anything but 'CLOSED' fails closed). --repo and the
// origin remote only choose the host (GitHub Enterprise Server) the lookup is sent to.
// Exit 0 on success; 1 on a malformed invocation (a segment that is not owner/name#N, unknown flag);
// 2 when `gh` is absent or owner/repo cannot be resolved (no `--repo` and no readable `origin` remote, or
// an origin host with no GitHub signal — refused before any gh call, #4933); 3 when the GraphQL call
// itself throws with no usable data (network/API failure).
//
// Consumers: bin/lib/issues/cross-repo-states.js's resolveForeignStates spawns this CLI and fails closed
// on any non-zero exit; the dispatch queue pull, /flow's prerequisite check, `dispatch resume`,
// wrap-up's unblocked-records pass and backlog's funnel reach it through bodyForeignBlockers (#4793).
'use strict';

const { fetchCrossRepoStates } = require('./lib/issues/cross-repo-states');
const { parseCrossRepoRef, crossRepoKey } = require('./lib/issues/cross-repo-refs');
const { makeNumberListCli } = require('./lib/number-list-cli');

const USAGE = 'usage: resolve-foreign-blockers.js <owner/name#N>[,<owner/name#N2>,...] [--repo owner/name] [--help]\n';

// 'a/b#1,A/B#1,c/d#2' -> ['a/b#1', 'c/d#2'] (distinct crossRepoKeys), or null on any entry that is
// not a well-formed owner/name#N. The number's range is checked by fetchCrossRepoStates, not here.
function parseRefs(raw) {
  const keys = new Set();
  for (const part of raw.split(',')) {
    const parsed = parseCrossRepoRef(part);
    if (!parsed) return null;
    keys.add(crossRepoKey(parsed));
  }
  return [...keys];
}

const { run, parseArgs, realDeps } = makeNumberListCli({
  name: 'resolve-foreign-blockers.js',
  usage: USAGE,
  parseList: parseRefs,
  malformedMessage: 'malformed <owner/name#N> — every entry must be owner/name#N',
  fetch: ({ numbers, host, runner }) => fetchCrossRepoStates({ refs: numbers, host, runner }),
  mapResult: (key, states) => states.get(key) ?? null,
});

module.exports = { run, parseArgs, parseRefs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
