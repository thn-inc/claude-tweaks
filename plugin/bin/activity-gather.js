#!/usr/bin/env node
// bin/activity-gather.js — thin CLI over bin/lib/activity/gather.js (#2757). Writes facts.json;
// nothing else. Logic lives in run(argv, deps); every side effect (runner, ghAvailable,
// ghAuthOk, remoteUrl, writeFile, stdout, stderr) is injected so tests never touch gh.
//
// Usage: activity-gather.js --period <1d|7d|14d|month|quarter|<from>..<to>>
//        [--repo <owner/name>[,<owner/name>...]] [--actor <login>] --out <facts.json path> [--help]
// Exit codes (Split-1/2, the resolve-blockers.js / fetch-sub-issues.js vocabulary):
//   0 success — including a PARTIAL gather (some queries failed; facts.failures[] names them)
//   1 malformed invocation (missing --period/--out, unknown flag, unrecognized period form,
//     a host-qualified --repo entry — every entry must live on gh's default github.com host —
//     a --actor value not shaped like a GitHub login, or an unwritable --out path)
//   2 missing dependency or unresolvable owner/repo (gh absent, `gh auth status` failing —
//     gh's own stderr relayed verbatim — no --repo and no readable/parsable origin remote, or
//     an origin remote on a host other than github.com)
//   3 the remote calls themselves failed — EVERY query, across every repo
// Actor defaults to `gh api user -q .login`; repo defaults to the origin remote via
// bin/lib/repo-resolve.js. Every gh call passes an explicit 15 s timeout (gather.js states why).
// Every resolved slug (--repo or origin) is canonicalized via one `gh repo view` call each:
// search-backed queries (gh search prs, --search) do not follow a repository rename/transfer
// redirect, even though `gh api`/`gh repo view` do, so a stale origin or a pre-transfer --repo
// would otherwise gather silently empty. `gh repo view` failing or returning an empty name is
// also an exit-2 cause, alongside the others listed above.
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { gather, PeriodError, ACTIVITY_GH_TIMEOUT_MS, resolvePeriod, QUERY_KEYS } = require('./lib/activity/gather');
const { parseRepo, ghAvailable, remoteUrl, repoSlug } = require('./lib/repo-resolve');

const USAGE = 'usage: activity-gather.js --period <1d|7d|14d|month|quarter|<from>..<to>> [--repo <owner/name>[,<owner/name>...]] [--actor <login>] --out <facts.json path> [--help]\n';

// GitHub login shape: alnum, internal hyphens only, no leading/trailing/double hyphen enforced
// loosely (a single run of hyphens is allowed; GitHub itself is the source of truth) — this is a
// sanity gate against shell-injection-shaped or whitespace-bearing values, not a full validator.
const ACTOR_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
// owner/name only: no host prefix (rejects a colon-host form like ghe.example.com:acme/widgets),
// no leading hyphen on the owner, no third `/`-separated segment.
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;

function parseArgs(argv) {
  const o = { period: null, repo: null, actor: null, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || v === '' || v.startsWith('--')) return null; i += 1; return v; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--period') { o.period = next(); if (o.period === null) return { error: '--period requires a value' }; }
    else if (a === '--repo') { o.repo = next(); if (o.repo === null) return { error: '--repo requires a value' }; }
    else if (a === '--actor') {
      o.actor = next(); if (o.actor === null) return { error: '--actor requires a value' };
      o.actor = o.actor.trim(); if (!o.actor) return { error: '--actor requires a value' };
      if (!ACTOR_RE.test(o.actor)) return { error: `--actor "${o.actor}" must be a GitHub login (letters, digits, hyphens; no spaces)` };
    }
    else if (a === '--out') { o.out = next(); if (o.out === null) return { error: '--out requires a value' }; }
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

function errorText(err) {
  const stderr = err && err.stderr && String(err.stderr).trim();
  if (stderr) return stderr;
  const parts = [err && err.message, err && err.stdout].filter((p) => p && String(p).trim());
  return parts.length ? parts.map((p) => String(p).trim()).join('\n') : String(err);
}

const realDeps = {
  runner: (args, opts) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }),
  ghAvailable: () => ghAvailable(),
  ghAuthOk: () => execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: ACTIVITY_GH_TIMEOUT_MS }),
  remoteUrl: () => remoteUrl(),
  writeFile: (p, text) => fs.writeFileSync(p, text),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  now: null,
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`activity-gather.js: ${message}\n${USAGE}`); return 1; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.period) return usageError('--period is required');
  if (!o.out) return usageError('--out is required');
  try { resolvePeriod(o.period, deps.now || undefined); } catch (err) { if (err instanceof PeriodError) return usageError(err.message); throw err; }

  let repos;
  if (o.repo) {
    repos = o.repo.split(',').map((s) => s.trim()).filter(Boolean);
    for (const r of repos) {
      if (!REPO_RE.test(r)) return usageError(`--repo entry "${r}" must be owner/name on gh's default host (github.com) — a host-qualified name is not supported; expected owner/name`);
    }
  }

  if (!deps.ghAvailable()) { deps.stderr('activity-gather.js: gh is not installed or not on PATH — install GitHub CLI (https://cli.github.com) and run `gh auth login`\n'); return 2; }
  try { deps.ghAuthOk(); } catch (err) { deps.stderr(`activity-gather.js: gh auth status failed:\n${errorText(err)}\n`); return 2; }

  if (!repos) {
    let url;
    try { url = deps.remoteUrl(); } catch (err) { deps.stderr(`activity-gather.js: no --repo and origin remote unreadable: ${errorText(err)}\n`); return 2; }
    const spec = parseRepo(url);
    if (!spec) { deps.stderr(`activity-gather.js: no --repo and origin remote is not a GitHub URL: ${String(url).trim()}\n`); return 2; }
    if (spec.host && spec.host !== 'github.com') {
      deps.stderr(`activity-gather.js: origin remote is on ${spec.host}, not github.com — pass --repo <owner/name> for a github.com repository; other hosts are not supported\n`);
      return 2;
    }
    repos = [repoSlug({ owner: spec.owner, repo: spec.repo })];
  }

  let actor = o.actor;
  if (!actor) {
    try { actor = String(deps.runner(['api', 'user', '-q', '.login'], { timeout: ACTIVITY_GH_TIMEOUT_MS })).trim(); } catch (err) {
      deps.stderr(`activity-gather.js: could not resolve the actor (gh api user): ${errorText(err)}\n`); return 2;
    }
    if (!actor) { deps.stderr('activity-gather.js: gh api user returned an empty login\n'); return 2; }
  }

  // Canonicalize every resolved slug: the search API does not follow a rename/transfer
  // redirect, so gathering under a stale name silently returns nothing from those queries even
  // though `gh repo view` itself resolves fine (see the header comment for why).
  const canonicalRepos = [];
  for (const slug of repos) {
    let canonical;
    try {
      canonical = String(deps.runner(['repo', 'view', slug, '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { timeout: ACTIVITY_GH_TIMEOUT_MS })).trim();
    } catch (err) {
      deps.stderr(`activity-gather.js: repository ${slug} not found or not accessible (gh repo view): ${errorText(err)}\n`);
      return 2;
    }
    if (!canonical) {
      deps.stderr(`activity-gather.js: repository ${slug} not found or not accessible (gh repo view): returned an empty name\n`);
      return 2;
    }
    if (canonical !== slug) {
      deps.stderr(`activity-gather.js: note — ${slug} redirects to ${canonical}; gathering under the canonical name\n`);
    }
    if (!canonicalRepos.includes(canonical)) canonicalRepos.push(canonical);
  }
  repos = canonicalRepos;

  let facts;
  try {
    facts = gather({ period: o.period, repos, actor }, { runner: deps.runner, now: deps.now || undefined });
  } catch (err) {
    if (err instanceof PeriodError) return usageError(err.message);
    throw err;
  }
  const attempted = repos.length * QUERY_KEYS.length;
  if (facts.failures.length === attempted) {
    deps.stderr(`activity-gather.js: every query failed (${attempted}/${attempted}); first: ${facts.failures[0].error}\n`);
    return 3;
  }
  try { deps.writeFile(o.out, JSON.stringify(facts, null, 2) + '\n'); } catch (err) {
    deps.stderr(`activity-gather.js: could not write ${o.out}: ${errorText(err)}\n`); return 1;
  }
  for (const f of facts.failures) deps.stderr(`activity-gather.js: partial gather — ${f.query} on ${f.repo} failed: ${f.error}\n`);
  deps.stdout(JSON.stringify({ out: o.out, actor, repos, period: facts.period, failures: facts.failures.length }) + '\n');
  return 0;
}

module.exports = { run, parseArgs, realDeps, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
