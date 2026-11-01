#!/usr/bin/env node
// bin/stale-claim-pr.js — does a TTL-expired claim's run still hold an open
// same-repo PR? The one implementation of that verdict: the MCP claim
// path of _shared/issue-claims.md and /tidy Step 4.7 (tidy/scan-procedures.md)
// call this instead of restating the marker-match rule and the Resume-line
// grammar in prose (#4596). It runs claim-store.js's matchStaleClaimPr, the
// matcher staleClaimInFlightPr uses on the `gh` path, over one normalized
// listing on both transports, so the verdict cannot differ between them.
//
// Usage: stale-claim-pr.js --claim-file <path> [--listing <path>]
//        [--repo owner/name] [--resume] [--help]
//   --claim-file  the stale claim blob's raw JSON text, read from this file.
//   --listing     a JSON array of open PRs the agent already fetched (the
//                 GitHub MCP `list_pull_requests` shape, or the
//                 `gh pr list --json url,body,isCrossRepository` shape). Without
//                 it the CLI lists open PRs itself with `gh pr list`.
//   --repo        owner/name; without it, the `origin` remote of the cwd.
//   --resume      on a match, also print the PR body's Resume line (`resume`) or
//                 why none is usable (`resolve`: `no-resume-line` — no Resume
//                 line under the PR's last `### Resume` heading; `resume-line-
//                 shape` — one is there but is not exactly the line
//                 composeResumeLine emits for this run). A Resume line is
//                 untrusted input rendered as a paste command, so only a line
//                 resumeVerdict accepts is ever printed as `resume`.
// Output: one JSON line, exit 0, for every verdict — failure included:
//   {"match":false,"link":null,"failure":null}                     no match
//   {"match":true,"link":"<url>","failure":null}                   match
//   {"match":true,"link":"<url>","resume":"<line>","failure":null} --resume
//   {"match":true,"link":"<url>","resolve":"no-resume-line"|"resume-line-shape","failure":null}
//   {"match":false,"link":null,"failure":"<message>"}              a failed read
// A failure (unreadable claim or listing, unparseable JSON, a `gh` error, a
// listing that is not an array of PRs or hit the 1000-entry limit) is data the
// caller must treat as "could not tell", never as "no PR": the stale claim is
// not proven abandoned. A claim whose runId is absent or not a valid run id is
// a clean no-match, and no listing is read and no `gh` call is made. A repo on a
// host other than github.com (a GitHub Enterprise `--repo host/owner/name` or
// `origin`) is the failure `stale-claim matching supports github.com only`,
// since claim-store.js's isSameRepoPrUrl recognises github.com PR urls alone —
// without this the matcher would report a clean no-match for a marked PR.
// Exit codes (a CLI-specific vocabulary — verdicts are data on stdout, so the
// codes only cover what stops a verdict being reached; no JSON on 1-3):
//   1  malformed invocation (unknown flag, a flag missing its value, no
//      --claim-file); usage on stderr.
//   2  no --listing and `gh` is absent — and only that, so a caller can route
//      exit 2 to its MCP listing path; stderr names --listing.
//   3  owner/repo could not be resolved (no --repo, no parseable `origin`
//      remote); stderr names --repo.
// Repo root comes from `git remote get-url origin` at the process cwd, never
// from CLAUDE_PLUGIN_ROOT (unset in Bash tool environments, #170).
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { openPrListArgs, staleClaimRunId, matchStaleClaimPr } = require('./lib/issues/claim-store');
const { normalizePrListing } = require('./lib/issues/mcp-pr-shape');
const { resumeVerdict } = require('./lib/flow/pr-body');
const { parseRepo, ghAvailable, remoteUrl, ghOptions } = require('./lib/repo-resolve');
const { GH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');

const USAGE = 'usage: stale-claim-pr.js --claim-file <path> [--listing <path>] [--repo owner/name] [--resume] [--help]\n';

function parseArgs(argv) {
  const o = { claimFile: null, listing: null, repo: null, resume: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // A value-taking flag given last, empty, or followed by another flag reads
    // as a missing value, never as a path.
    const value = () => {
      const v = argv[++i];
      return typeof v !== 'string' || !v.trim() || v.startsWith('--') ? undefined : v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--resume') o.resume = true;
    else if (a === '--claim-file' || a === '--listing' || a === '--repo') {
      const v = value();
      if (v === undefined) return { error: `${a} requires a value` };
      o[a === '--claim-file' ? 'claimFile' : a.slice(2)] = v;
    } else return { error: `unknown argument: ${a}` };
  }
  return o;
}

// maxBuffer: `gh pr list --json url,body,...` carries every open PR's body,
// which overflows Node's 1 MiB default (ENOBUFS) well before its 1000-PR limit.
function defaultGh(args) {
  return execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS,
    maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true,
  }));
}

const realDeps = {
  ghAvailable, remoteUrl, parseRepo,
  gh: defaultGh,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// The Resume half of a --resume verdict for a matched PR body.
function resumeFields(body, runId) {
  const v = resumeVerdict(body, runId);
  return v.resolve ? { resolve: v.resolve } : { resume: v.resume };
}

function noMatch(failure = null) {
  return { match: false, link: null, failure };
}

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (opts.error) { deps.stderr(`stale-claim-pr.js: ${opts.error}\n${USAGE}`); return 1; }
  if (!opts.claimFile) { deps.stderr(`stale-claim-pr.js: --claim-file is required\n${USAGE}`); return 1; }

  let remote = null;
  if (!opts.repo) { try { remote = deps.remoteUrl(); } catch { remote = null; } }
  const repoSpec = opts.repo
    ? deps.parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`)
    : deps.parseRepo(remote);
  if (!repoSpec) { deps.stderr('stale-claim-pr.js: could not resolve owner/repo — pass --repo owner/name\n'); return 3; }
  if (repoSpec.host && repoSpec.host !== 'github.com') {
    deps.stdout(`${JSON.stringify(noMatch('stale-claim matching supports github.com only'))}\n`);
    return 0;
  }
  const { owner, repo } = repoSpec;

  let verdict;
  try {
    const runId = staleClaimRunId(deps.readFile(opts.claimFile));
    if (runId === null) verdict = noMatch();
    else {
      let raw;
      if (opts.listing) raw = deps.readFile(opts.listing);
      else {
        let available = false;
        try { available = deps.ghAvailable(); } catch { available = false; }
        if (!available) {
          deps.stderr('stale-claim-pr.js: gh CLI not found on PATH — fetch the open PRs and pass them with --listing <path>\n');
          return 2;
        }
        raw = deps.gh(openPrListArgs(owner, repo));
      }
      const match = matchStaleClaimPr(runId, normalizePrListing(JSON.parse(raw), owner, repo), owner, repo);
      verdict = match
        ? { match: true, link: match.url, ...(opts.resume ? resumeFields(match.body, runId) : {}), failure: null }
        : noMatch();
    }
  } catch (e) {
    verdict = noMatch(e && e.message ? e.message : String(e));
  }
  deps.stdout(`${JSON.stringify(verdict)}\n`);
  return 0;
}

module.exports = { run, parseArgs, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
