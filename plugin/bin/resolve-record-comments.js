#!/usr/bin/env node
// bin/resolve-record-comments.js — single-invocation CLI wrapping
// bin/lib/issues/record-comments.js's fetchRecordComments behind one shell
// command, for /dispatch's `driver-lane` queue-pull exclusion (#6119): the
// exclusion spawns it with the few records it would drop and spares one whose
// comments carry the driver's trusted escalation marker. Built on
// bin/lib/number-list-cli.js's shared scaffold (parseNumbers/parseArgs/
// realDeps/exit codes), as bin/resolve-linked-prs.js is. Zero runtime npm deps.
//
// Usage: resolve-record-comments.js <n>[,<n2>,...] [--repo [host/]owner/name] [--help]
// A comma-joined list (no spaces) batches every number into ONE aliased
// GraphQL call — never more than one gh call however many numbers are passed.
// Output: one JSON line, an object keyed by each requested number (a string,
// JSON's key convention) to {"comments": [{body, authorAssociation, url,
// author}], "complete": boolean}; `complete` is false when the record has more
// than the 100 comments one call returns. A number whose record the response
// did not carry is absent from the object (the caller reads an absent entry as
// unread). Exit codes are resolve-linked-prs.js's: 0 success; 1 malformed
// invocation; 2 `gh` absent or owner/repo unresolvable (no --repo and no
// readable origin remote, or an origin host with no GitHub signal, #4933);
// 3 the GraphQL call itself threw. Repo comes from `git remote get-url origin`
// at the process cwd, never CLAUDE_PLUGIN_ROOT (#170).
'use strict';

const { fetchRecordComments } = require('./lib/issues/record-comments');
const { makeNumberListCli } = require('./lib/number-list-cli');

const USAGE = 'usage: resolve-record-comments.js <n>[,<n2>,...] [--repo [host/]owner/name] [--help]\n';

const { run, parseArgs, parseNumbers, realDeps } = makeNumberListCli({
  name: 'resolve-record-comments.js',
  usage: USAGE,
  fetch: ({
    numbers, owner, repo, host, runner,
  }) => fetchRecordComments({
    numbers, owner, repo, host, runner,
  }),
  mapResult: (n, byNumber) => byNumber.get(n),
});

module.exports = { run, parseArgs, parseNumbers, parseRepo: require('./lib/repo-resolve').parseRepo };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
