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

const { CI_HEALTH_GH_TIMEOUT_MS, RUNS_PER_PAGE, MAX_RUN_PAGES, RUN_PAGE_BUDGET } = require('./constants');
const { bucketRanges } = require('./stats');

const ERROR_TEXT_MAX = 300;

// stderr, else the message; trimmed, first 300 chars. Never stdout: a call that fails after partial
// output (ENOBUFS, a timeout) leaves response body text there, and a billing body can hold amounts.
function errorText(err) {
  const stderr = err && err.stderr ? String(err.stderr).trim() : '';
  const message = err && err.message ? String(err.message).trim() : '';
  const text = stderr || message || String(err);
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

const isoSecond = (ms) => `${new Date(ms).toISOString().slice(0, 19)}Z`;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// Reads the window one stats.js bucket at a time (`from` is the window's UTC-midnight start Date,
// the one computeStats gets), newest bucket first, so a read the budget cuts keeps the most recent
// weeks, as the old single newest-first query did. GitHub's `created=a..b` is inclusive at both
// ends (probed live), so each range ends one second before the next begins and a run created on a
// boundary is read once, in the bucket stats.js puts it in. Each range pages 1..MAX_RUN_PAGES,
// stopping after a short or failed page; RUN_PAGE_BUDGET bounds the calls across all ranges.
// `available` = at least one page was read; `truncatedRanges` names, oldest first, each range whose
// page MAX_RUN_PAGES came back full (`cap`) or that the budget left unread or cut mid-read
// (`budget`), and `truncated` is true when there is one. Runs are kept once per `id` (first
// occurrence): a run created mid-read shifts the pages, so a run can repeat.
function fetchRuns({ owner, repo, from, days }, { runner }) {
  const result = { available: false, runs: [], pages: 0, truncated: false, truncatedRanges: [], ghAbsent: false, failures: [] };
  const seen = new Set();
  let calls = 0;
  for (const { startMs, endMs } of bucketRanges(from, days).reverse()) {
    if (result.ghAbsent) break;
    const label = `${isoDay(startMs)}..${isoDay(endMs)}`;
    let reason = null;
    for (let n = 1; ; n += 1) {
      if (n > MAX_RUN_PAGES) { reason = 'cap'; break; }
      if (calls === RUN_PAGE_BUDGET) { reason = 'budget'; break; }
      calls += 1;
      const args = [
        'api', '--method', 'GET', `repos/${owner}/${repo}/actions/runs`,
        '-f', `created=${isoSecond(startMs)}..${isoSecond(endMs - 1000)}`, '-f', `per_page=${RUNS_PER_PAGE}`, '-f', `page=${n}`,
      ];
      let page;
      try {
        const body = parseBody(runner(args, { timeout: CI_HEALTH_GH_TIMEOUT_MS }));
        page = body && body.workflow_runs;
        if (!Array.isArray(page)) throw new Error(`runs ${label} page ${n}: response has no workflow_runs array`);
      } catch (err) {
        // gh absent on the first call renders from `ghAbsent` alone, so it adds no failure row and
        // no range is tried after it. gh vanishing later is a failed page like any other: that
        // range is only partly read, and the next range is still tried.
        if (calls === 1 && isGhAbsent(err)) result.ghAbsent = true;
        else result.failures.push({ query: `runs ${label} page ${n}`, status: httpStatusOf(err), error: errorText(err) });
        break;
      }
      for (const run of page) {
        const id = run && run.id;
        if (id != null) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        result.runs.push(run);
      }
      result.pages += 1;
      result.available = true;
      if (page.length < RUNS_PER_PAGE) break;
    }
    if (reason) result.truncatedRanges.unshift({ from: isoDay(startMs), to: isoDay(endMs), reason });
  }
  result.truncated = result.truncatedRanges.length > 0;
  return result;
}

module.exports = { errorText, httpStatusOf, isGhAbsent, parseBody, readRepo, fetchRuns };
