// plugin/bin/lib/ci-health/fetch.js — the repo read and the paged `repos/{o}/{r}/actions/runs` read
// behind /claude-tweaks:harness-health's CI health check (#5161), plus the error helpers the billing
// reads reuse.
//
// Every read goes through an injected `runner(args, opts)` (bin/ci-health.js defines the real
// execFileSync runner); each call passes an explicit { timeout: CI_HEALTH_GH_TIMEOUT_MS }. Every
// `-f` field would flip `gh api` to POST, so each read passes `--method GET`. Paths start with a
// literal `repos/`, so no value reads as a flag; owner/repo are validated by the CLI before they
// reach this module (the `.`/`..` path-segment guard lives there).
'use strict';

const { CI_HEALTH_GH_TIMEOUT_MS, RUNS_PER_PAGE, MAX_RUN_PAGES } = require('./constants');

const ERROR_TEXT_MAX = 300;

// stderr, else message + stdout; trimmed, first 300 chars.
function errorText(err) {
  const stderr = err && err.stderr ? String(err.stderr).trim() : '';
  const text = stderr || [err && err.message, err && err.stdout]
    .filter((p) => p && String(p).trim())
    .map((p) => String(p).trim())
    .join(' ') || String(err);
  return text.slice(0, ERROR_TEXT_MAX);
}

// The HTTP status gh prints (`HTTP 404: Not Found`, `... (HTTP 429)`), stderr first, else null.
function httpStatusOf(err) {
  for (const source of [err && err.stderr, err && err.message]) {
    const m = source ? /HTTP (\d{3})/.exec(String(source)) : null;
    if (m) return Number(m[1]);
  }
  return null;
}

function isGhAbsent(err) {
  return Boolean(err) && err.code === 'ENOENT';
}

function parseBody(out) {
  return typeof out === 'string' ? JSON.parse(out) : out;
}

function readRepo({ owner, repo }, { runner }) {
  try {
    const body = parseBody(runner(['api', '--method', 'GET', `repos/${owner}/${repo}`], { timeout: CI_HEALTH_GH_TIMEOUT_MS }));
    const ownerType = body && body.owner && body.owner.type;
    const ownerLogin = body && body.owner && body.owner.login;
    const defaultBranch = body && body.default_branch;
    if (typeof ownerType !== 'string' || typeof ownerLogin !== 'string' || typeof defaultBranch !== 'string') {
      throw new Error(`repos/${owner}/${repo}: response lacks owner.type, owner.login or default_branch`);
    }
    return { ok: true, ownerType, ownerLogin, defaultBranch };
  } catch (err) {
    return { ok: false, status: httpStatusOf(err), error: errorText(err), ghAbsent: isGhAbsent(err) };
  }
}

// Reads pages 1..MAX_RUN_PAGES of the window, stopping after a short page, a failed page, or gh
// absence. `available` = page 1 succeeded; `truncated` = the last allowed page was full.
function fetchRuns({ owner, repo, from }, { runner }) {
  const result = { available: false, runs: [], pages: 0, truncated: false, ghAbsent: false, failures: [] };
  for (let n = 1; n <= MAX_RUN_PAGES; n += 1) {
    const args = [
      'api', '--method', 'GET', `repos/${owner}/${repo}/actions/runs`,
      '-f', `created=>=${from}`, '-f', `per_page=${RUNS_PER_PAGE}`, '-f', `page=${n}`,
    ];
    let page;
    try {
      const body = parseBody(runner(args, { timeout: CI_HEALTH_GH_TIMEOUT_MS }));
      page = body && body.workflow_runs;
      if (!Array.isArray(page)) throw new Error(`runs page ${n}: response has no workflow_runs array`);
    } catch (err) {
      // gh absence renders from `ghAbsent` alone, so it adds no failure row.
      if (isGhAbsent(err)) result.ghAbsent = true;
      else result.failures.push({ query: `runs page ${n}`, status: httpStatusOf(err), error: errorText(err) });
      break;
    }
    result.runs.push(...page);
    result.pages = n;
    result.available = true;
    if (page.length < RUNS_PER_PAGE) break;
    if (n === MAX_RUN_PAGES) result.truncated = true;
  }
  return result;
}

module.exports = { errorText, httpStatusOf, isGhAbsent, readRepo, fetchRuns };
