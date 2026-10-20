#!/usr/bin/env node
// bin/resolved-refusal.js — single-invocation CLI for
// bin/lib/issues/resolved-refusal.js (#3597): decides whether a `needs-decision`
// refusal stays resolved, so `/claude-tweaks:backlog refine` stops re-asking a
// grant decision a human already made. One GraphQL call (fetchResolvedRefusalEvidence)
// feeds the pure evaluator (evaluateResolvedRefusal); the CLI only wires the
// owner/repo resolution and the exit-code contract around them.
//
// Usage: resolved-refusal.js <n> [--repo owner/name] [--help]
// Output: one JSON line on stdout — {number, ...evaluateResolvedRefusal result}.
// Exit 0 on any verdict (suppress true or false, any `reason`). Exit 1: the
// `gh api graphql` call failed, returned GraphQL errors, or the issue is missing
// (stderr names it; a caller treats this as fail-closed). Exit 2: malformed
// invocation (missing or non-positive-integer <n>, unknown flag), `gh` absent,
// or owner/repo could not be resolved (no --repo and no readable `origin` remote).
'use strict';

const { evaluateResolvedRefusal, fetchResolvedRefusalEvidence, defaultRunner } = require('./lib/issues/resolved-refusal');
const { parseRepo, ghAvailable, remoteUrl } = require('./lib/repo-resolve');

const USAGE = 'usage: resolved-refusal.js <n> [--repo owner/name] [--help]\n';

function parseArgs(argv) {
  const opts = { number: null, repo: null, help: false };
  if (argv[0] === '--help' || argv[0] === '-h') { opts.help = true; return opts; }
  if (argv[0] === undefined || argv[0].startsWith('--')) return { error: 'missing <n> argument' };
  if (!/^[0-9]+$/.test(argv[0]) || Number(argv[0]) <= 0) return { error: `malformed <n>: ${argv[0]} (must be a positive integer)` };
  opts.number = Number(argv[0]);
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--repo') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) return { error: 'missing value for --repo' };
      opts.repo = v;
      i++;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return opts;
}

const realDeps = {
  runner: defaultRunner,
  ghAvailable,
  remoteUrl,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// argv -> exit code. All I/O through deps so tests never touch gh or git.
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(`resolved-refusal.js: ${opts.error}\n${USAGE}`); return 2; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (!deps.ghAvailable()) { deps.stderr('resolved-refusal.js: `gh` is required\n'); return 2; }

  let remote = null;
  if (!opts.repo) { try { remote = deps.remoteUrl(); } catch { remote = null; } }
  // A --repo value is either bare `owner/repo` (github.com implied) or host-qualified
  // `host/owner/repo`; only the bare form needs the github.com prefix to reach
  // parseRepo's 3-segment regex (number-list-cli.js's resolution, same rule).
  const repoSpec = opts.repo
    ? parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`)
    : parseRepo(remote);
  if (!repoSpec) { deps.stderr('resolved-refusal.js: could not resolve owner/repo — pass --repo owner/name\n'); return 2; }
  const { owner, repo, host } = repoSpec;

  let evidence;
  try {
    evidence = fetchResolvedRefusalEvidence({ number: opts.number, owner, repo, host, runner: deps.runner });
  } catch (err) {
    deps.stderr(`resolved-refusal.js: ${err && err.message ? err.message : String(err)}\n`);
    return 1;
  }

  const verdict = evaluateResolvedRefusal({ number: opts.number, ...evidence });
  deps.stdout(`${JSON.stringify({ number: opts.number, ...verdict })}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
