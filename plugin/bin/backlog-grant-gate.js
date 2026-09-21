#!/usr/bin/env node
// bin/backlog-grant-gate.js — single-invocation CLI running
// skills/backlog/refine-headless.md's Step 0 (ceiling gate) through Step 2 Phase A
// (gates 1-3, pure) in one shot: resolves the relevant policy keys, fetches
// the ready-labeled candidate pool and the historical record set trustRows
// grades, computes the trust table, and evaluates every candidate's
// evaluateGrantGate Phase A verdict — the same conclusion
// overview-mode.md's machineGrantOutlook already computes cheaply for its
// own funnel render (#1384's Current State: a human/agent previously had to
// hand-run ~40 Bash/`node -e` steps to reach this same conclusion).
//
// The historical `--state all` record fetch reads through the session-scoped
// record snapshot (_shared/record-queue-fetch.md, bin/lib/issues/record-
// snapshot.js) the same way every other scan in this plugin does — one
// continuous session pulling the whole issue set independently per skill
// invocation doesn't burn a round-trip per call for identical data.
//
// Usage: backlog-grant-gate.js [--repo owner/name] [--limit N] [--help]
// Output: one JSON envelope on stdout —
//   { ceiling, grantOriginationEnabled, shortcut, candidates, trustRows,
//     phaseA, eligible, refused }
// `shortcut` is 'ceiling-gate' (Step 0 never cleared — the same "nothing to
// do" stop refine-headless.md's Step 0 has always reported), 'zero-eligible'
// (Step 0 cleared but not one candidate reached needsGrantCheck: true — the
// caller's per-candidate Phase B/C loop has nothing to run this firing,
// #1384's Deliverable 2), or null (at least one candidate is eligible; the
// caller proceeds to Phase B for `eligible`).
//
// Exit 0 on any of the three shapes above (including both shortcuts — a
// short-circuit is a normal outcome, not a failure). Exit 1: a required `gh`
// or `git` call failed (message names which one). Exit 2: malformed
// invocation, `gh` absent, or (native work-links only) owner/repo could not
// be resolved.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolvePolicyKeys } = require('./lib/policy-schema');
const { parseRepo, ghAvailable, remoteUrl } = require('./lib/repo-resolve');
const { computeOutlook } = require('./lib/backlog-grant-gate/backlog-grant-gate');
const { LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');

const USAGE = 'usage: backlog-grant-gate.js [--repo owner/name] [--limit N] [--help]\n';

function parseArgs(argv) {
  const opts = { repo: null, limit: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; }
    else if (a === '--repo') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) return { error: 'missing value for --repo' };
      opts.repo = v; i++;
    } else if (a === '--limit') {
      const v = argv[i + 1];
      const n = Number(v);
      if (!v || v.startsWith('--') || !Number.isInteger(n) || n <= 0) return { error: 'missing or invalid value for --limit (must be a positive integer)' };
      opts.limit = n; i++;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return opts;
}

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function errorText(err) {
  const parts = [err && err.message, err && err.stderr, err && err.stdout].filter(Boolean).map(String);
  return parts.length ? parts.join(' ') : String(err);
}

const realDeps = {
  ghAvailable,
  remoteUrl,
  // maxBuffer widened past Node's 1MB default: fetchAllRecords' historical
  // `--state all` fetch returns full bodies for up to `backlog-fetch-limit`
  // (default 1000) records and routinely exceeds it on a backlog this size
  // (spawnSync gh ENOBUFS, observed live). No `timeout` here deliberately:
  // this fetch's duration scales with backlog-fetch-limit and a fixed bound
  // risks aborting exactly the large-backlog call this fix targets (`gh`
  // paginating internally, GitHub secondary-rate-limit backoff) — under the
  // `unattended` ceiling this runs with no human to retry, so a spurious
  // timeout-kill is worse than the slow-but-eventually-successful unbounded
  // call it would replace.
  runner: (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: LARGE_MAX_BUFFER_BYTES }),
  // maxBuffer widened for the same reason: fetchGitLog dumps every commit
  // message on the integration branch in one call.
  gitRunner: (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: LARGE_MAX_BUFFER_BYTES }),
  readPolicyRaw: () => readFileSafe(path.join(repoRoot(), '.claude-tweaks', 'policy.yml')),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// argv -> exit code. All I/O through deps so tests never touch gh/git.
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(`backlog-grant-gate.js: ${opts.error}\n${USAGE}`); return 2; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (!deps.ghAvailable()) { deps.stderr('backlog-grant-gate.js: `gh` is required\n'); return 2; }

  const policyRaw = deps.readPolicyRaw();
  const resolved = resolvePolicyKeys(
    ['autonomy', 'grant-origination-enabled', 'risk-floor', 'size-floor', 'backlog-fetch-limit', 'trust-revert-window-days', 'work-links', 'integration-branch', 'record-snapshot-ttl-seconds'],
    { policyRaw },
  );
  const ceiling = resolved.autonomy.value;
  const grantOriginationEnabled = resolved['grant-origination-enabled'].value === true;
  const policy = {
    ceiling,
    grantOriginationEnabled,
    riskFloor: resolved['risk-floor'].value,
    sizeFloor: resolved['size-floor'].value,
    windowDays: resolved['trust-revert-window-days'].value,
  };

  // Ceiling gate short-circuits before any network call — the ceiling and
  // opt-in are whole-run facts, not per-candidate ones (refine-headless.md Step 0).
  if (ceiling !== 'unattended' || !grantOriginationEnabled) {
    deps.stdout(`${JSON.stringify(computeOutlook(policy, {}))}\n`);
    return 0;
  }

  const limit = opts.limit || resolved['backlog-fetch-limit'].value;
  const workLinks = resolved['work-links'].value;

  let owner = null;
  let repo = null;
  let host = null;
  if (workLinks === 'native') {
    let remote = null;
    if (!opts.repo) { try { remote = deps.remoteUrl(); } catch { remote = null; } }
    const repoSpec = parseRepo(opts.repo ? (opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`) : remote);
    if (!repoSpec) { deps.stderr('backlog-grant-gate.js: could not resolve owner/repo — pass --repo owner/name\n'); return 2; }
    // #1443: parseRepo's regex accepts any non-'/' owner/repo segment, including '.'/'..'
    // (#1153 review finding). resolveSubIssueNumbers's REST fallback (lib/backlog-grant-gate/
    // backlog-grant-gate.js) builds a `repos/${owner}/${repo}/issues/.../sub_issues` path via
    // direct string interpolation rather than gh's bound-variable mechanism, so a crafted
    // --repo value reaches that path string. Reject it here rather than narrowing the shared
    // parseRepo, which 8 other CLIs also call — same guard shape as fetch-sub-issues.js's own
    // #1153 fix.
    if (repoSpec.owner === '.' || repoSpec.owner === '..' || repoSpec.repo === '.' || repoSpec.repo === '..') {
      deps.stderr('backlog-grant-gate.js: invalid --repo value — owner/repo cannot be "." or ".."\n');
      return 2;
    }
    owner = repoSpec.owner; repo = repoSpec.repo; host = repoSpec.host;
  }

  let integrationBranch = resolved['integration-branch'].value;
  if (!integrationBranch) {
    try {
      integrationBranch = deps.gitRunner(['rev-parse', '--abbrev-ref', 'origin/HEAD']).trim().replace(/^origin\//, '');
    } catch (err) {
      deps.stderr(`backlog-grant-gate.js: could not resolve the integration branch (no policy value, and git rev-parse origin/HEAD failed: ${errorText(err)})\n`);
      return 1;
    }
    // git succeeded but printed nothing usable — the policy path above can
    // never land here, since a set policy value skips this whole block.
    if (!integrationBranch) { deps.stderr('backlog-grant-gate.js: could not resolve the integration branch\n'); return 1; }
  }

  let envelope;
  try {
    envelope = computeOutlook(policy, {
      limit,
      workLinks,
      integrationBranch,
      owner,
      repo,
      host,
      runner: deps.runner,
      gitRunner: deps.gitRunner,
      sessionId: process.env.CLAUDE_CODE_SESSION_ID,
      ttlSeconds: resolved['record-snapshot-ttl-seconds'].value,
    });
  } catch (err) {
    deps.stderr(`backlog-grant-gate.js: ${errorText(err)}\n`);
    return 1;
  }

  deps.stdout(`${JSON.stringify(envelope)}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
