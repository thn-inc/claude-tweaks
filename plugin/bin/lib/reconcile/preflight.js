// bin/lib/reconcile/preflight.js — a cheap upfront GitHub-health check so
// reconcile() degrades once, fast, instead of every network-dependent check
// separately discovering the same outage via its own 5-10s timeout (#820).
'use strict';
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const { classifyGhApiError } = require('../issues/claim-store');
const { runClassified, runClassifiedAsync } = require('../shared-primitives');

const execFileAsync = promisify(execFile);

// #2567: this bound is deliberately its own, smaller value — not GH_TIMEOUT_MS
// — so a single retry-on-timeout (opted into below) still costs at most 4s
// worst case, well under a real check's 5-10s cold-call latency.
const PREFLIGHT_TIMEOUT_MS = 2000;

function defaultRunner(args, timeoutMs) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs, windowsHide: true });
}

async function defaultRunnerAsync(args, timeoutMs) {
  const { stdout } = await execFileAsync('gh', args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  return stdout;
}

// Shared by both ghHealthCheck and ghHealthCheckAsync below — defined once
// so the two twins' success/failure shape cannot silently drift (#1652,
// mirrors git-exec.js's runGit/runGitAsync consolidation).
function buildSuccess() {
  return { ok: true, reason: null };
}

function buildFailure(e) {
  // Classification (ENOENT vs everything else) is shared with claim-store.js
  // and pr-state.js rather than reimplemented a third time here — only the
  // REASON VOCABULARY differs (this check reports 'github-unreachable', not
  // 'network-failure' — a different consumer, a different word for the same
  // classification) (review finding: 5 near-identical copies).
  const { failure } = classifyGhApiError(e);
  return failure === 'gh-absent' ? { ok: false, reason: 'gh-absent' } : { ok: false, reason: 'github-unreachable' };
}

// -> { ok: boolean, reason: null | 'gh-absent' | 'github-unreachable' }
// `rate_limit` is deliberately repo-agnostic and cheap — it answers "can we
// reach the GitHub API at all", not "does this repo's data look right".
function ghHealthCheck(opts = {}) {
  const timeoutMs = opts.timeoutMs || PREFLIGHT_TIMEOUT_MS;
  const runner = opts.runner || ((args) => defaultRunner(args, timeoutMs));
  return runClassified(
    () => { runner(['api', 'rate_limit', '-q', '.rate.remaining']); return buildSuccess(); },
    buildFailure,
    { retryOnTimeout: true },
  );
}

// Async twin of ghHealthCheck — a real (non-blocking) execFile, so
// reconcile/index.js's FAST_CHECKS dispatch can run this concurrently with
// the shared git fetch via Promise.all instead of paying for both serially
// (#872). Mirrors resolvePrStateAsync's (pr-state.js) established
// execFile-based async pattern: same buildSuccess/buildFailure as the sync
// version above — only the blocking-vs-non-blocking spawn differs.
async function ghHealthCheckAsync(opts = {}) {
  const timeoutMs = opts.timeoutMs || PREFLIGHT_TIMEOUT_MS;
  const runner = opts.runner || ((args) => defaultRunnerAsync(args, timeoutMs));
  return runClassifiedAsync(
    async () => { await runner(['api', 'rate_limit', '-q', '.rate.remaining']); return buildSuccess(); },
    buildFailure,
    { retryOnTimeout: true },
  );
}

module.exports = { ghHealthCheck, ghHealthCheckAsync, PREFLIGHT_TIMEOUT_MS };
