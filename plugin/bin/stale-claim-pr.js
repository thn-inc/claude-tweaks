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
//        [--repo owner/name] [--resume [--issue <n>]] [--help]
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
//                 resumeVerdict accepts is ever printed as `resume`. With
//                 --issue, when the matched run's directory is absent or
//                 archived, `resume` is instead the dispatch-resume command
//                 (`/claude-tweaks:dispatch resume #<n>`), since the PR body's
//                 line names a directory that is gone (#4673). That command finds
//                 only a dispatched run, so it is printed only when the run id's
//                 slug is `record-<n>`; any other gone run (a direct /flow run's
//                 `spec-<n>`) is `resolve`: `run-dir-gone` — its PR body line is
//                 broken too, and dispatch resume could not find it.
//   --issue       the claim's issue number (a positive integer; requires --resume,
//                 else exit 1). Consulted only on a match. The run directory is
//                 gone when archive/{runId} holds a run-state.json whose status is
//                 not 'archiving'; when archive/{runId} exists and pipelines/{runId}
//                 holds no run-state.json; or when pipelines/{runId} is absent. A
//                 probe that cannot tell (no main checkout, a throw) is not gone.
// Output: one JSON line, exit 0, for every verdict — failure included:
//   {"match":false,"link":null,"failure":null}                     no match
//   {"match":true,"link":"<url>","failure":null}                   match
//   {"match":true,"link":"<url>","resume":"<line>","failure":null} --resume
//   {"match":true,"link":"<url>","resolve":"no-resume-line"|"resume-line-shape"|"run-dir-gone","failure":null}
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
//   1  malformed invocation (unknown flag, a flag missing its value, an
//      --issue that is not a positive integer or comes without --resume, no
//      --claim-file); usage on stderr.
//   2  no --listing and `gh` is absent — and only that, so a caller can route
//      exit 2 to its MCP listing path; stderr names --listing.
//   3  owner/repo could not be resolved (no --repo, no parseable `origin`
//      remote); stderr names --repo.
// Repo root comes from `git remote get-url origin` at the process cwd, never
// from CLAUDE_PLUGIN_ROOT (unset in Bash tool environments, #170).
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { openPrListArgs, staleClaimRunId, matchStaleClaimPr } = require('./lib/issues/claim-store');
const { normalizePrListing } = require('./lib/issues/mcp-pr-shape');
const { resumeVerdict } = require('./lib/flow/pr-body');
const { parseRepo, ghAvailable, remoteUrl, ghOptions } = require('./lib/repo-resolve');
const { mainCheckoutRoot } = require('./lib/hooks/worktree-detect');
const { lstatType } = require('./lib/path-guard');
const { RUN_ID_PREFIX_LENGTH } = require('./lib/dispatch/resume-eligibility');
const { GH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');

const USAGE = 'usage: stale-claim-pr.js --claim-file <path> [--listing <path>] [--repo owner/name] [--resume [--issue <n>]] [--help]\n';

function parseArgs(argv) {
  const o = { claimFile: null, listing: null, repo: null, resume: false, issue: null, help: false };
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
    else if (a === '--issue') {
      const v = value();
      if (v === undefined || !/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v))) return { error: '--issue requires a positive integer' };
      o.issue = Number(v);
    } else if (a === '--claim-file' || a === '--listing' || a === '--repo') {
      const v = value();
      if (v === undefined) return { error: `${a} requires a value` };
      o[a === '--claim-file' ? 'claimFile' : a.slice(2)] = v;
    } else return { error: `unknown argument: ${a}` };
  }
  if (o.issue !== null && !o.resume && !o.help) return { error: '--issue requires --resume' };
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
  pipelinesRoot: () => {
    const root = mainCheckoutRoot(process.cwd());
    return root ? path.join(root, '.claude-tweaks', 'pipelines') : null;
  },
  exists: (p) => lstatType(p).type !== 'missing',
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// The Resume half of a --resume verdict for a matched PR body.
function resumeFields(body, runId) {
  const v = resumeVerdict(body, runId);
  return v.resolve ? { resolve: v.resolve } : { resume: v.resume };
}

// Is the matched run's directory gone — archived or absent — so the PR body's Resume line names
// nothing a session can resume from? Exactly dispatch-resume.js's classifyPriorRun cases that return
// `archived` or `absent` (tests/stale-claim-pr-cli.test.js pins the two against one world matrix):
// archive/{runId} holds a run-state.json object whose status is not 'archiving' (the marker
// archiveRunDir writes before moving anything); or archive/{runId} exists and the root dir holds no
// run-state.json (a late-write stub); or the root dir is absent.
// A probe that cannot tell (no main checkout, a throw) is "not gone": today's PR-body route.
function runDirGone(deps, runId) {
  try {
    const root = deps.pipelinesRoot();
    if (!root) return false;
    const archiveDir = path.join(root, 'archive', runId);
    if (deps.exists(archiveDir)) {
      try {
        const state = JSON.parse(deps.readFile(path.join(archiveDir, 'run-state.json')));
        if (state !== null && typeof state === 'object' && !Array.isArray(state) && state.status !== 'archiving') return true;
      } catch { /* an unreadable archive state is not a real archive: fall through to the root check */ }
      if (!deps.exists(path.join(root, runId, 'run-state.json'))) return true;
    }
    return !deps.exists(path.join(root, runId));
  } catch {
    return false;
  }
}

// The Resume half of a --resume verdict: when --issue names the claim and its run dir is gone
// (whatever the PR body says), the dispatch-resume command for a dispatched run (slug `record-{n}`),
// else `run-dir-gone` (dispatch resume could not find the run); otherwise the PR body's own line.
// runId.slice(RUN_ID_PREFIX_LENGTH) is the run's slug: `record-{n}` for a dispatched run (the slug
// selectResumePr checks, which `dispatch resume #n` uses to find the run's PR), `spec-{n}` for a
// direct /flow run.
function resumeFor(opts, body, runId, deps) {
  if (opts.issue !== null && runDirGone(deps, runId)) {
    if (runId.slice(RUN_ID_PREFIX_LENGTH) !== `record-${opts.issue}`) return { resolve: 'run-dir-gone' };
    return { resume: `\`/claude-tweaks:dispatch resume #${opts.issue}\`` };
  }
  return resumeFields(body, runId);
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
        ? { match: true, link: match.url, ...(opts.resume ? resumeFor(opts, match.body, runId, deps) : {}), failure: null }
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
