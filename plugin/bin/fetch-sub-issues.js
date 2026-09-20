#!/usr/bin/env node
// bin/fetch-sub-issues.js — single-invocation CLI wrapping
// bin/lib/issues/native-dependencies.js's fetchNativeSubIssues (batched,
// aliased GraphQL sub-issue enumeration) behind one shell command,
// mirroring bin/resolve-blockers.js's CLI shape: thin argument-parsing
// shell over a bin/lib/ function, injectable runner. Exists so a
// worktree-isolated session's compound-Bash refusal on hand-rolling
// `gh api graphql` with bound variables (skills/_shared/scratch-worktree.md's
// Shell constraint section) has a single-command escape hatch for #1097's
// batched sub-issue fetch. Zero runtime npm deps.
//
// Usage: fetch-sub-issues.js [<n> ...] [--repo owner/name] [--resolve-retries] [--help]
// Output: one JSON line {"byParent":{"1095":[1097,1101]},"retry":[]} on
// stdout — byParent as a plain object keyed by stringified number (JSON has
// no Map). Prose invokes this via command substitution, not `xargs`; zero
// positional numbers is still a valid invocation and prints
// {"byParent":{},"retry":[]} (exit 0) — the empty envelope. Exit 0 on success; 1 on a malformed
// invocation (non-positive-integer positional, unknown flag); 2 when `gh`
// is absent or owner/repo cannot be resolved (no `--repo` and no readable
// `origin` remote); 3 when the GraphQL call itself throws (network/API
// failure, or fetchNativeSubIssues' own missing-repository guard) — or when
// capabilities-probe.js's probeSchemaStrict call fails outright (runner
// throw, JSON.parse failure): a transient/network probe failure, distinct
// from genuine capability absence (#1185); also covers a `--resolve-retries`
// per-parent REST retry call failing (parent named on stderr); 4 when that same probe call
// completes cleanly and reports the subIssues GraphQL field genuinely
// unavailable on this host — the caller falls back to the per-parent REST
// loop. Input is chunked at 50 numbers per fetchNativeSubIssues call,
// merging byParent/retry across chunks. Repo root comes from
// `git remote get-url origin` at the process cwd — never from
// CLAUDE_PLUGIN_ROOT (unset in Bash tool environments, #170) — mirroring
// bin/resolve-blockers.js's --repo override + remote-url fallback.
'use strict';

const { execFileSync } = require('child_process');
const { fetchNativeSubIssues } = require('./lib/issues/native-dependencies');
const { probeSchemaStrict } = require('./lib/issues/capabilities-probe');
const { parseRepo, ghAvailable, remoteUrl } = require('./lib/repo-resolve');

const USAGE = 'usage: fetch-sub-issues.js [<n> ...] [--repo owner/name] [--resolve-retries] [--help]\n';

const isPos = (n) => Number.isInteger(n) && n > 0;

function parseArgs(argv) {
  const opts = { numbers: [], repo: null, help: false, resolveRetries: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; }
    else if (a === '--resolve-retries') { opts.resolveRetries = true; }
    else if (a === '--repo') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) return { error: 'missing value for --repo' };
      opts.repo = v;
      i++;
    }
    else if (a.startsWith('--')) { return { error: `unknown argument: ${a}` }; }
    else {
      const n = Number(a);
      if (!isPos(n)) return { error: `malformed positional — must be a positive integer: ${a}` };
      opts.numbers.push(n);
    }
  }
  return opts;
}

const realDeps = {
  ghAvailable,
  remoteUrl,
  // 30s bound: a 50-alias GraphQL batch outweighs the 5s single-call convention
  // (gh-api-module-pattern's "bound every remote-contacting call" rule).
  runner: (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 30000 }),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// argv -> exit code. All I/O through deps so tests never touch gh or git —
// same seam as bin/resolve-blockers.js's run(argv, deps).
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(opts.error + '\n' + USAGE); return 1; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  // Zero positional numbers is documented as "still a valid invocation" that guarantees exit 0
  // with the empty envelope — never gated on gh/owner-repo/schema resolution, none of which the
  // empty result depends on (review finding: this used to run those unconditionally first, so a
  // zero-arg caller on a host with no `gh`, no origin remote, or a fail-safe probeSchema result
  // got exit 2/4 instead of the documented guarantee).
  if (opts.numbers.length === 0) { deps.stdout(`${JSON.stringify({ byParent: {}, retry: [] })}\n`); return 0; }
  if (!deps.ghAvailable()) { deps.stderr('fetch-sub-issues.js: `gh` is required (work-links: native)\n'); return 2; }

  let remote = null;
  if (!opts.repo) { try { remote = deps.remoteUrl(); } catch { remote = null; } }
  const repoSpec = opts.repo ? parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`) : parseRepo(remote);
  if (!repoSpec) { deps.stderr('fetch-sub-issues.js: could not resolve owner/repo — pass --repo owner/name\n'); return 2; }
  const { host, owner, repo } = repoSpec;
  // parseRepo's regex accepts any non-'/' owner/repo segment, including '.'/'..' — review finding
  // (#1153): the --resolve-retries REST call below interpolates owner/repo directly into a path
  // rather than using gh's bound-variable mechanism (unlike the GraphQL fetch, which already binds
  // via native-dependencies.js's -f owner=/-f repo=), so a '..' segment from a crafted --repo value
  // would reach that path string. Reject it here rather than narrowing the shared parseRepo, which
  // 9 other CLIs also call.
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') {
    deps.stderr('fetch-sub-issues.js: invalid --repo value — owner/repo cannot be "." or ".."\n');
    return 2;
  }

  let schema;
  try {
    schema = probeSchemaStrict(deps.runner);
  } catch (err) {
    deps.stderr(`fetch-sub-issues.js: subIssues capability probe failed — ${err && err.message ? err.message : String(err)}\n`);
    return 3;
  }
  if (!schema.subIssues) {
    deps.stderr('fetch-sub-issues.js: the subIssues GraphQL field is unavailable on this host — fall back to the per-parent REST loop\n');
    return 4;
  }
  const byParent = {};
  const retry = [];
  try {
    for (let i = 0; i < opts.numbers.length; i += 50) {
      const chunk = opts.numbers.slice(i, i + 50);
      const res = fetchNativeSubIssues({ numbers: chunk, owner, repo, runner: deps.runner });
      for (const [n, subs] of res.byParent) byParent[n] = subs;
      retry.push(...res.retry);
    }
  } catch (err) {
    deps.stderr(`fetch-sub-issues.js: ${err && err.message ? err.message : String(err)}\n`);
    return 3;
  }
  if (opts.resolveRetries && retry.length > 0) {
    for (const n of retry) {
      let nums;
      try {
        const apiArgs = ['api', '--paginate', `repos/${owner}/${repo}/issues/${n}/sub_issues`, '--jq', '.[].number'];
        if (host !== 'github.com') apiArgs.push('--hostname', host);
        const out = deps.runner(apiArgs);
        nums = out.trim().split('\n').filter(Boolean).map(Number);
      } catch (err) {
        deps.stderr(`fetch-sub-issues.js: sub-issue REST retry failed for parent #${n}: ${err && err.message ? err.message : String(err)}\n`);
        return 3;
      }
      byParent[n] = (byParent[n] || []).concat(nums);
    }
    retry.length = 0;
  }
  deps.stdout(`${JSON.stringify({ byParent, retry })}\n`);
  return 0;
}

module.exports = { run, parseArgs, parseRepo };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
