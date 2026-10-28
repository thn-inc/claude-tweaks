// plugin/bin/lib/verify/ci-source.js — a suite's full-run verdict taken from
// the PR's CI job on HEAD instead of a local run (#4347). verify.js calls
// fetchCiVerdict for a suite whose `.claude-tweaks/verify-scope.json` names a
// `ci` source; every `gh` call goes through the injectable `runner(args, opts)`
// seam (gh-api-module-pattern), REST only, with gh's own `{owner}/{repo}`
// path placeholders resolved from the checkout's remote (REST follows a repo
// rename; GraphQL is never needed).
//
// The verdict is either `used: true` with a check result shaped like
// run.js's runOne output — its log is the CI job's log, normalized so the
// existing extract/flaky/baseline paths read it as if it ran here — or
// `used: false` with a named `fallback` reason, and verify.js runs the suite
// locally as before. Every unknown falls back; nothing here ever reports a
// pass it did not read from a completed, successful CI job at exactly HEAD.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { GH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('../shared-primitives');

// A job log is one download of up to a few MB — wider than the 5s single-call
// bound on purpose, so a slow log fetch is not misread as "unavailable".
const LOG_TIMEOUT_MS = 30000;
const SHA_RE = /^[0-9a-f]{40}$/;

function defaultRunner(args, { cwd = null, timeout = GH_TIMEOUT_MS } = {}) {
  return execFileSync('gh', args, {
    encoding: 'utf8', cwd: cwd || undefined, timeout, maxBuffer: LARGE_MAX_BUFFER_BYTES, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
}

function defaultSleep(ms) { return new Promise((resolve) => { setTimeout(resolve, ms); }); }

// GitHub's job log prefixes every line with an ISO timestamp, and the runner
// checks the repo out at /home/runner/work/{repo}/{repo} (D:\a\{repo}\{repo} on
// Windows). Both are stripped/remapped so failing-file extraction resolves
// paths against the local checkout (extract.js relativizes under its cwd).
function normalizeCiLog(text, localRoot) {
  const root = String(localRoot || '').replace(/[\\/]+$/, '');
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/, ''))
    .map((line) => (root
      ? line
        .replace(/\/home\/runner\/work\/[^/\s]+\/[^/\s]+(?=[/\s:)]|$)/g, root)
        .replace(/[A-Za-z]:\\a\\[^\\\s]+\\[^\\\s]+(?=[\\\s:)]|$)/g, root)
      : line))
    .join('\n');
}

function errText(err) {
  const raw = String((err && (err.stderr || err.message)) || err).trim();
  return raw.split(/\r?\n/)[0] || 'unknown error';
}

function isMissingCommit(err) {
  return /HTTP 4(04|22)\b|No commit found/i.test(String((err && (err.stderr || err.message)) || ''));
}

// Distinguishes "gh is not installed" from a gh call that ran and failed.
class CiFallback extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

async function fetchCiVerdict({
  suite, source, headSha, logDir, localRoot, cwd = null,
  runner = defaultRunner, sleep = defaultSleep, now = Date.now,
}) {
  const startedMs = now();
  const ci = {
    suite, workflow: source.workflow, job: source.job, used: false, fallback: null,
    prNumber: null, runId: null, runUrl: null, jobId: null, conclusion: null, waitedMs: 0,
  };
  const fallback = (reason) => {
    ci.fallback = reason;
    ci.waitedMs = now() - startedMs;
    return { used: false, ci };
  };
  const gh = (args, timeout = GH_TIMEOUT_MS) => {
    try {
      return runner(args, { cwd, timeout });
    } catch (err) {
      if (err && err.code === 'ENOENT') throw new CiFallback('gh-unavailable');
      throw err;
    }
  };
  const ghJson = (args) => {
    const out = gh(args);
    try { return JSON.parse(out); } catch { throw new CiFallback(`gh-error: unparseable response from gh ${args[1]}`); }
  };

  if (typeof headSha !== 'string' || !SHA_RE.test(headSha)) return fallback('no-head-sha');
  try {
    // HEAD must be on GitHub and be the head of an open PR — CI's pull_request
    // runs exist only for a PR's head, and a run for any other sha would
    // vouch for a tree this checkout is not.
    let pulls;
    try {
      pulls = ghJson(['api', `repos/{owner}/{repo}/commits/${headSha}/pulls`]);
    } catch (err) {
      if (err instanceof CiFallback) throw err;
      if (isMissingCommit(err)) return fallback('head-not-pushed');
      throw new CiFallback(`gh-error: ${errText(err)}`);
    }
    const pr = Array.isArray(pulls)
      ? pulls.find((p) => p && p.state === 'open' && p.head && p.head.sha === headSha)
      : null;
    if (!pr) return fallback('no-open-pr-at-head');
    ci.prNumber = pr.number;
    // A conflicted PR gets no pull_request runs at all — say so now instead of
    // waiting out the whole budget. A failed read here is not evidence either
    // way; the wait below still bounds it.
    try {
      const full = ghJson(['api', `repos/{owner}/{repo}/pulls/${Number(pr.number)}`]);
      if (full && full.mergeable_state === 'dirty') return fallback('pr-conflicted');
    } catch (err) {
      if (err instanceof CiFallback && err.reason === 'gh-unavailable') throw err;
    }

    const deadline = startedMs + source.waitSeconds * 1000;
    const workflowSeg = encodeURIComponent(source.workflow);
    let job = null;
    let run = null;
    for (;;) {
      const runs = ghJson(['api', `repos/{owner}/{repo}/actions/workflows/${workflowSeg}/runs?head_sha=${headSha}&per_page=20`]);
      const list = runs && Array.isArray(runs.workflow_runs)
        ? runs.workflow_runs.filter((r) => r && r.head_sha === headSha)
        : [];
      run = list.sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
      if (run) {
        ci.runId = run.id;
        ci.runUrl = run.html_url || null;
        const jobs = ghJson(['api', `repos/{owner}/{repo}/actions/runs/${Number(run.id)}/jobs?per_page=100`]);
        job = jobs && Array.isArray(jobs.jobs) ? jobs.jobs.find((j) => j && j.name === source.job) || null : null;
        if (job && job.status === 'completed') break;
        if (!job && run.status === 'completed') return fallback('ci-job-not-found');
      }
      if (now() >= deadline) return fallback(run ? 'ci-run-incomplete-within-wait' : 'no-ci-run-within-wait');
      await sleep(Math.min(source.pollSeconds * 1000, Math.max(0, deadline - now())));
    }

    ci.jobId = job.id;
    ci.conclusion = job.conclusion;
    if (job.conclusion === 'cancelled') return fallback('ci-run-cancelled');
    if (job.conclusion !== 'success' && job.conclusion !== 'failure') return fallback(`ci-job-${job.conclusion}`);

    const logPath = path.join(logDir, `${suite}.log`);
    let logText = null;
    try {
      logText = gh(['api', `repos/{owner}/{repo}/actions/jobs/${Number(job.id)}/logs`], LOG_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof CiFallback && err.reason === 'gh-unavailable') throw err;
      // A red job with no log names no failing test — never adjudicable, so
      // the suite runs here instead. A green job's verdict stands without it.
      if (job.conclusion === 'failure') return fallback('ci-log-unavailable');
    }
    const body = logText === null
      ? `CI job ${job.html_url || job.id} passed; its log could not be fetched.\n`
      : `${normalizeCiLog(logText, localRoot)}\n`;
    fs.writeFileSync(logPath, body);
    const started = Date.parse(job.started_at);
    const completed = Date.parse(job.completed_at);
    ci.used = true;
    ci.waitedMs = now() - startedMs;
    return {
      used: true,
      ci,
      result: {
        name: suite,
        command: `ci: ${source.workflow} / ${source.job} — run ${run.id}`,
        exitCode: job.conclusion === 'success' ? 0 : 1,
        durationMs: Number.isFinite(started) && Number.isFinite(completed) ? completed - started : 0,
        logPath,
      },
    };
  } catch (err) {
    if (err instanceof CiFallback) return fallback(err.reason);
    return fallback(`gh-error: ${errText(err)}`);
  }
}

module.exports = { fetchCiVerdict, normalizeCiLog, defaultRunner, LOG_TIMEOUT_MS };
