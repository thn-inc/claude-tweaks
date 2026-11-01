#!/usr/bin/env node
// bin/list-claims.js — single-invocation CLI wrapping
// bin/lib/issues/claim-store.js's listClaimEntries behind one shell command,
// so a skill-prose consumer of the `claims/` keyspace (_shared/issue-claims.md,
// _shared/github-pr-scan.md, tidy/scan-procedures.md) calls this instead of
// hand-rolling the `gh api` Git Trees call inline (#3098). Centralizing the
// call here means the uncapped-listing fix and its truncation detection live
// in one tested place, not re-derived at each of the three prose call sites.
//
// Usage: list-claims.js [--repo owner/name] [--format names|json] [--help]
// `--format names` (default): one `claims/issue-{n}.json` filename per
// line on stdout — the exact shape the old `gh api .../contents/claims
// -q '.[].name'` one-liner produced, so every existing `while read -r
// FNAME` prose loop keeps working unchanged. `--format json`: the full
// `[{name, sha}, ...]` array as one JSON line, for a caller that also wants
// each blob's sha (mirrors listClaimEntries' own return shape).
// Exit 0 on success (including zero claims — an empty registry is not an
// error); 1 on a malformed invocation (unknown flag, bad --format value);
// 2 when `gh` is absent or owner/repo cannot be resolved (no `--repo` and
// no readable `origin` remote); 3 when the underlying call itself fails —
// `gh-absent` (environment changed between the availability probe and the
// call), `network-failure`, `secondary-rate-limit`, or `truncated` (the Git
// Trees API itself reports `truncated: true` — the one case this CLI must
// never treat as a complete-but-short list, per #3098's own Acceptance
// Criteria). Repo root comes from `git remote get-url origin` at the
// process cwd — never from CLAUDE_PLUGIN_ROOT (unset in Bash tool
// environments, #170) — mirroring bin/materialize.js's --repo override +
// remote-url fallback.
'use strict';

const { listClaimEntries, defaultGhApi } = require('./lib/issues/claim-store');
const {
  parseRepo, ghAvailable, remoteUrl, repoSlug, pinExplicitRepoHost,
} = require('./lib/repo-resolve');

const USAGE = 'usage: list-claims.js [--repo owner/name] [--format names|json] [--help]\n';
const FORMATS = ['names', 'json'];

function parseArgs(argv) {
  const o = { repo: null, format: 'names', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; return v === undefined ? null : v; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--repo') o.repo = next();
    else if (a === '--format') o.format = next();
    else return { error: `unknown argument: ${a}` };
  }
  if (!FORMATS.includes(o.format)) return { error: `--format must be one of: ${FORMATS.join('|')}` };
  return o;
}

const realDeps = {
  ghAvailable, remoteUrl, parseRepo, repoSlug,
  listClaimEntries, ghApi: defaultGhApi,
  // #4505: an explicit --repo's host reaches the contents-API listing, whose
  // `repos/{slug}/…` path carries no host flag.
  pinGhHost: (repoSpec) => pinExplicitRepoHost(repoSpec),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (opts.error) { deps.stderr(`list-claims.js: ${opts.error}\n${USAGE}`); return 1; }

  if (!deps.ghAvailable()) { deps.stderr('list-claims.js: gh CLI not found on PATH\n'); return 2; }

  let remote = null;
  if (!opts.repo) { try { remote = deps.remoteUrl(); } catch { remote = null; } }
  const repoSpec = opts.repo
    ? deps.parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`)
    : deps.parseRepo(remote);
  if (!repoSpec) { deps.stderr('list-claims.js: could not resolve owner/repo — pass --repo owner/name\n'); return 2; }
  if (opts.repo && deps.pinGhHost) deps.pinGhHost(repoSpec);

  const slug = deps.repoSlug(repoSpec);
  const { entries, failure } = deps.listClaimEntries(deps.ghApi, slug);
  if (failure) { deps.stderr(`list-claims.js: ${failure}\n`); return 3; }

  if (opts.format === 'json') deps.stdout(`${JSON.stringify(entries)}\n`);
  else for (const e of entries) deps.stdout(`${e.name}\n`);
  return 0;
}

module.exports = { run, parseArgs, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
