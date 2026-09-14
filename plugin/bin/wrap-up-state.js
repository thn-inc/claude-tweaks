#!/usr/bin/env node
// bin/wrap-up-state.js — emit the wrap-up State block and the history operations
// in scope, read from git rather than recalled.
//
// Exit codes: 0 for any successful render INCLUDING a degraded one (fields render
// `unknown`); 2 only for a malformed invocation. A degraded read must never cost
// the caller the whole report.
'use strict';

const { execFileSync } = require('node:child_process');
const { readState } = require('./lib/wrap-up/state');
const { historyOps } = require('./lib/wrap-up/reflog');
const { renderState } = require('./lib/wrap-up/render');

function parseArgs(argv) {
  const out = { since: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since' && i + 1 < argv.length && !argv[i + 1].startsWith('--')) { out.since = argv[i + 1]; i += 1; continue; }
    if (argv[i] === '--json') { out.json = true; continue; }
  }
  return out;
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function main() {
  const { since, json } = parseArgs(process.argv.slice(2));
  if (!since) {
    process.stderr.write('usage: wrap-up-state.js --since <base-sha> [--json]\n');
    process.exitCode = 2;
    return;
  }
  const cwd = process.cwd();
  const state = readState({ cwd, since });

  // `since` is a commit-ish (a base sha). Resolve it TO a full ISO 8601
  // datetime for git reflog's --since=, and echo the base back so a wrong base
  // is visible in the rendered block rather than silently narrowing the
  // window. A bare date would land on 1970-01-01 for a zero timestamp and
  // return nothing in positive-UTC-offset zones, so this resolution — not a
  // raw date string — is what reflog's --since= is always given.
  //
  // Outside a git repository there is nothing to resolve against, and the
  // whole State block already degrades to `unknown` — that stays exit 0.
  // Inside a repository, an unresolvable `since` IS a malformed invocation
  // under the base-sha-only contract: falling back to the raw string hands
  // git reflog's --since= a value it cannot parse either, which exits 0 with
  // an empty window — indistinguishable from "no history operations
  // occurred." Error loudly instead of reproducing [IL-47].
  let sinceDate = since;
  if (state.isRepo) {
    sinceDate = git(['show', '-s', '--format=%cI', since], cwd);
    if (!sinceDate) {
      process.stderr.write(`wrap-up-state.js: --since value is not a resolvable commit-ish: ${since}\n`);
      process.exitCode = 2;
      return;
    }
  }
  const head = git(['reflog', '--date=iso', `--since=${sinceDate}`], cwd) || '';
  // Prefer the configured upstream's reflog; when there is none, fall back to
  // the branch's own origin/{branch} remote-tracking ref (state.js's
  // remote-ref fallback, #1869) so the concatenated-reflog logic below sees
  // that ref's updates too, on a pr-first branch pushed without `-u`.
  const remoteRef = state.upstream || state.remoteRef;
  const remote = remoteRef
    ? git(['reflog', 'show', remoteRef, '--date=iso', `--since=${sinceDate}`], cwd) || ''
    : '';
  // Concatenating the two reflogs (HEAD's and, when it exists, the upstream's)
  // is non-monotonic whenever both contribute — sort newest-first so the
  // rendered date column reads as a single timeline rather than two
  // interleaved ones.
  const ops = [...historyOps(head), ...historyOps(remote)]
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // `rendered` is the block itself, not a second source for it: a consumer
  // reading this JSON (the wrap-up fact pack, #1930) pastes that string
  // verbatim, exactly as a consumer of the non-JSON form does. Composing the
  // block from the sibling fields instead is what summary-template.md's
  // "Render VERBATIM from the helper" rule exists to forbid, and --json
  // silently made it possible.
  const rendered = renderState({ state, ops, since, sinceDate });
  if (json) {
    process.stdout.write(`${JSON.stringify({ state, ops, since, sinceDate, rendered }, null, 2)}\n`);
  } else {
    process.stdout.write(`${rendered}\n`);
  }
}

main();
