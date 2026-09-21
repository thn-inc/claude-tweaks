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
//     a host-qualified --repo entry — every entry must live on gh's default github.com host)
//   2 missing dependency or unresolvable owner/repo (gh absent, `gh auth status` failing —
//     gh's own stderr relayed verbatim — or no --repo and no readable/parsable origin remote)
//   3 the remote calls themselves failed — EVERY query, across every repo
// Actor defaults to `gh api user -q .login`; repo defaults to the origin remote via
// bin/lib/repo-resolve.js. Every gh call passes an explicit 15 s timeout (gather.js states why).
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { gather, PeriodError, ACTIVITY_GH_TIMEOUT_MS } = require('./lib/activity/gather');
const { parseRepo, ghAvailable, remoteUrl, repoSlug } = require('./lib/repo-resolve');

const USAGE = 'usage: activity-gather.js --period <1d|7d|14d|month|quarter|<from>..<to>> [--repo <owner/name>[,<owner/name>...]] [--actor <login>] --out <facts.json path> [--help]\n';

function parseArgs(argv) {
  const o = { period: null, repo: null, actor: null, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) return null; i += 1; return v; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--period') { o.period = next(); if (o.period === null) return { error: '--period requires a value' }; }
    else if (a === '--repo') { o.repo = next(); if (o.repo === null) return { error: '--repo requires a value' }; }
    else if (a === '--actor') { o.actor = next(); if (o.actor === null) return { error: '--actor requires a value' }; }
    else if (a === '--out') { o.out = next(); if (o.out === null) return { error: '--out requires a value' }; }
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

function errorText(err) {
  const parts = [err && err.message, err && err.stderr, err && err.stdout].filter((p) => p && String(p).trim());
  return parts.length ? parts.map((p) => String(p).trim()).join('\n') : String(err);
}

const realDeps = {
  runner: (args, opts) => execFileSync('gh', args, { encoding: 'utf8', ...opts }),
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

  let repos;
  if (o.repo) {
    repos = o.repo.split(',').map((s) => s.trim()).filter(Boolean);
    for (const r of repos) {
      const parts = r.split('/');
      if (parts.length !== 2 || !parts[0] || !parts[1]) return usageError(`--repo entry "${r}" must be owner/name on gh's default host (github.com) — a host-qualified name is not supported`);
    }
  }

  if (!deps.ghAvailable()) { deps.stderr('activity-gather.js: gh is not installed or not on PATH — install GitHub CLI (https://cli.github.com) and run `gh auth login`\n'); return 2; }
  try { deps.ghAuthOk(); } catch (err) { deps.stderr(`activity-gather.js: gh auth status failed:\n${errorText(err)}\n`); return 2; }

  if (!repos) {
    let url;
    try { url = deps.remoteUrl(); } catch (err) { deps.stderr(`activity-gather.js: no --repo and origin remote unreadable: ${errorText(err)}\n`); return 2; }
    const spec = parseRepo(url);
    if (!spec) { deps.stderr(`activity-gather.js: no --repo and origin remote is not a GitHub URL: ${String(url).trim()}\n`); return 2; }
    repos = [repoSlug({ owner: spec.owner, repo: spec.repo })];
  }

  let actor = o.actor;
  if (!actor) {
    try { actor = String(deps.runner(['api', 'user', '-q', '.login'], { timeout: ACTIVITY_GH_TIMEOUT_MS })).trim(); } catch (err) {
      deps.stderr(`activity-gather.js: could not resolve the actor (gh api user): ${errorText(err)}\n`); return 2;
    }
    if (!actor) { deps.stderr('activity-gather.js: gh api user returned an empty login\n'); return 2; }
  }

  let facts;
  try {
    facts = gather({ period: o.period, repos, actor }, { runner: deps.runner, now: deps.now || undefined });
  } catch (err) {
    if (err instanceof PeriodError) return usageError(err.message);
    throw err;
  }
  const attempted = repos.length * 6;
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
