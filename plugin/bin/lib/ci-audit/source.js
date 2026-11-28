// plugin/bin/lib/ci-audit/source.js — /claude-tweaks:ci-health's (#5757) one source adapter: the
// only ci-audit module that names a forge (GitHub Actions), a forge CLI (`gh`), a workflow-file
// location (`.github/workflows`), resolves the repository or its host, or spawns a process. It maps
// what the forge returns onto the vendor-neutral shape every other ci-audit module consumes, and
// reads nothing but run data and the workflow files. It never writes, never files, never edits a
// workflow. Text it returns (failures, truncation lines, refusals, an empty-read reason) may name
// the forge: it is adapter text the CLI relays, like GH_ABSENT.
//
//   NormRun  = { id, workflow, conclusion, createdAt, jobs: NormJob[] }
//   NormJob  = { name, createdAt, startedAt, completedAt, conclusion, steps: NormStep[] }
//   NormStep = { name, number, conclusion, startedAt, completedAt }
// Instants are the forge's ISO-8601 strings, passed through unparsed (a non-string reads as null);
// every forge field the shape does not name is dropped here and nowhere else. Conclusions pass
// through: the forge's `skipped` (a job or step its `if:` left out, zero-length times) and
// `cancelled` are the two the aggregate and the phase split read.
//
// Field mapping (GitHub REST, probed against a real repository on 2026-11-16):
//  - NormRun.workflow is the checkout-relative workflow file the runs were listed for
//    (`.github/workflows/test.yml`, from readWorkflowFiles): the one key the workflow facts, the
//    `--workflow` filter and findings share.
//  - NormJob.createdAt is the job's `created_at`, the instant the job became runnable (queued). For a
//    job with `needs` the forge creates it when its dependencies finish, so this holds for dependent
//    jobs too: on the probed run, `test` (needs the `shard` matrix) had created_at 16:14:02, equal
//    to the last shard's completed_at, and started_at 16:14:08. The aggregate's critical path
//    (created→completed per job, summed along `needs`) relies on that; no adjustment is made.
//  - Steps map name, number, conclusion, started_at, completed_at; a non-array `steps` reads as [].
//    The forge adds steps no workflow file declares (`Set up job`, `Post …`, `Complete job`).
//
// Step names (stepRunName, withRunNames): the forge shows a step by its `name:`, or, when it has
// none, as `Run ` + the first line of its `run` script or its `uses` reference (`Run npm run
// test:perf`, `Run actions/checkout@v7`; probed). withRunNames gives each workflow-facts step its
// run-data name as `runName` (null when the step's value could not be read), so the phase split
// can match declared steps to run steps; this naming rule lives here and nowhere else.
//
// readRunData reads, for each workflow file of `listing` (readWorkflowFiles' result) that the
// `workflow` filter keeps, that workflow's completed runs created in the window, newest first,
// one `actions/workflows/{file}/runs` page at a time (100 a page, at most MAX_RUN_PAGES pages), and
// stops a workflow's paging as soon as it holds `maxRuns` (DEFAULT_MAX_RUNS, at most MAX_RUNS)
// runs that did work (NO_WORK_CONCLUSIONS, `skipped`, are left out and counted in
// unsampled.skipped), or the window has no more runs. Every workflow keeps its own newest
// `maxRuns`, so a frequent workflow cannot starve a rare one. The sampled runs are then read in
// round-robin order across workflows (each one's newest first) up to MAX_TOTAL_RUNS in all; each
// run's jobs are one `actions/runs/{id}/jobs` read per page (`filter=latest`, 100 a page, at most
// MAX_JOB_PAGES pages; a run past the cap keeps what was read and is named in `truncated`). A
// failed or malformed read adds one failure line; a body that is not JSON reads `response is not
// JSON`, so no response byte reaches `failures`.
// -> { ok, cliAbsent, runs, truncated, failures, unsampled, workflow, empty }:
//  - workflow: the workflow file the filter matched (null with no filter or no match).
//  - empty: a reason when the read could sample nothing for a cause that is not a failure — no
//    workflow file at `.github/workflows/`, or a filter that matched no workflow file — else null.
//  - cliAbsent: the first call threw ENOENT (fetch.js's ghAbsent); one failure line names gh absent.
//    gh vanishing after it answered once is a failed read, and cliAbsent stays false.
//  - ok false: the workflow files could not be listed; no workflow's runs page was read (gh absent
//    included); runs were sampled but no run's jobs were read (every jobs read failed, or the
//    deadline left them all unread: failures may then be empty, truncated names them); or an
//    invalid input refused before any call with one failure line (repo not owner/name; maxRuns not
//    an integer 1..MAX_RUNS; days not an integer 1..MAX_DAYS; now not a valid Date; a non-null
//    workflow that normalizes to no path). A read that succeeds with zero sampled runs is ok:true,
//    runs:[]; a failed read never looks clean.
//  - truncated: only what could have changed the sample — a workflow whose pages ran out
//    (`page cap`) or whose listing the deadline cut before it held maxRuns runs, listed runs left
//    out by MAX_TOTAL_RUNS, sampled runs whose jobs the deadline left unread (one line per
//    workflow), a run cut at the jobs page cap, and a run whose full jobs page came without a
//    total_count, and the runs left unread when MAX_JOB_FAIL_STREAK jobs reads failed in a row (a
//    dead forge or token fails every run alike; one line, the failures keep each failed read). A
//    workflow that holds maxRuns runs, or whose window ran out, is complete.
//  - unsampled: { skipped, neverRun } — the NO_WORK runs seen while paging, and the listed
//    workflow files the forge answered 404 for (it has never run them: an empty read, not a
//    failure), so an empty sample can say why. When every list call answers 404 the
//    repository itself may be wrong, so each is a failure line and the read is ok:false.
// Scope: only workflow files in the checkout's `.github/workflows/` are read. Runs of any other
// workflow — a file deleted, renamed or absent from this branch, or one the forge generates
// itself (its `dynamic/…` workflows) — are never listed, and the report counts none of them.
//
// Bounds: every call passes { timeout: CI_HEALTH_GH_TIMEOUT_MS } (ci-health's 15 s github.com read
// bound) and `--method GET` on a literal `repos/` path, so no value reads as a flag; owner/name is
// validated here (no leading `-`, no `.`/`..` segment), a workflow file name must be a plain file
// name, and a run id must be a positive safe integer before either reaches a path. With a `clock`
// (epoch ms), the whole read keeps inside CI_HEALTH_DEADLINE_MS from its first call: the listing
// stops JOBS_RESERVE_MS short of the deadline, leaving the jobs reads that much, and no call starts
// that could end past its limit.
// resolveRepo({ repo, root }, deps) -> { slug } | { error }: `repo` (owner/name) as given, else the
// origin remote of `root` (or the current directory) through repo-resolve.js's gateOriginRepo,
// which refuses a host gh does not know; either way the host is pinned (pinExplicitRepoHost) so
// every later call reaches it. deps.remoteUrl / pinHost / gateDeps replace the real ones in tests;
// deps.cwd (() => string) names the current directory the default remote read falls back to.
// makeRunner(spawn) is the real runner: gh through repo-resolve.js's ghOptions (the pinned host
// reaches every call), windowsHide, piped stdio, LARGE_MAX_BUFFER_BYTES and the caller's timeout
// (else the shared bound).
// readWorkflowFiles(root) is init's readWorkflowSet (path-guarded, symlinks out of the checkout
// refused), keyed `file`, with CRLF line endings read as LF so a Windows checkout parses the same.
'use strict';

const { execFileSync } = require('child_process');
const { ghOptions, originUrl, gateOriginRepo, pinExplicitRepoHost } = require('../repo-resolve');
const { LARGE_MAX_BUFFER_BYTES } = require('../shared-primitives');
const { errorText, httpStatusOf, isGhAbsent, parseBody } = require('../ci-health/fetch');
const { oneLine } = require('../ci-health/render');
const {
  CI_HEALTH_GH_TIMEOUT_MS, CI_HEALTH_DEADLINE_MS, DEFAULT_DAYS, MAX_DAYS, NO_WORK_CONCLUSIONS,
} = require('../ci-health/constants');
const { readWorkflowSet } = require('../init/ci-workflow-review');

const DEFAULT_MAX_RUNS = 20;
const MAX_RUNS = 30;
// Ten workflows at MAX_RUNS; the deadline, not this bound, is what keeps the read inside 570 s.
const MAX_TOTAL_RUNS = 300;
const RUNS_PER_PAGE = 100;
const MAX_RUN_PAGES = 5;
const JOBS_PER_PAGE = 100;
const MAX_JOB_PAGES = 3;
const JOBS_RESERVE_MS = 300000;
const MAX_JOB_FAIL_STREAK = 5;
const WORKFLOW_DIR = '.github/workflows/';
const DAY_MS = 24 * 60 * 60 * 1000;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;
const FILE_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

const GH_ABSENT = 'gh (the GitHub CLI) is not installed or not on PATH — no run data read';
const NO_WORKFLOW_FILES = `no workflow files readable at ${WORKFLOW_DIR} — the one CI layout this adapter reads`;

const str = (v) => (typeof v === 'string' ? v : null);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function validRepo(slug) {
  return typeof slug === 'string' && REPO_RE.test(slug) && slug.split('/').every((s) => s !== '.' && s !== '..');
}

function normPath(p) {
  if (typeof p !== 'string' || p === '') return null;
  const s = p.replace(/\\/g, '/').replace(/^\.\//, '');
  return /[^/.]/.test(s) ? s : null;
}

// The name the run data gives a workflow-facts step, or null when it cannot be known.
function stepRunName(step) {
  if (!step || typeof step !== 'object') return null;
  if (step.named === true) return typeof step.name === 'string' ? step.name : null;
  return typeof step.value === 'string' && step.value !== '' ? `Run ${step.value}` : null;
}

function withRunNames(facts) {
  if (!facts || !Array.isArray(facts.jobs)) return facts;
  return {
    ...facts,
    jobs: facts.jobs.map((j) => (j && Array.isArray(j.steps)
      ? { ...j, steps: j.steps.map((s) => ({ ...s, runName: stepRunName(s) })) }
      : j)),
  };
}

function normJob(j) {
  return {
    name: str(j && j.name),
    createdAt: str(j && j.created_at),
    startedAt: str(j && j.started_at),
    completedAt: str(j && j.completed_at),
    conclusion: str(j && j.conclusion),
    steps: Array.isArray(j && j.steps)
      ? j.steps.map((s) => ({
        name: str(s && s.name),
        number: s && Number.isFinite(s.number) ? s.number : null,
        conclusion: str(s && s.conclusion),
        startedAt: str(s && s.started_at),
        completedAt: str(s && s.completed_at),
      }))
      : [],
  };
}

// The failure text for a thrown read: fixed text for gh absent and for a body that is not JSON
// (JSON.parse's message quotes the body's opening bytes).
const whyOf = (err) => (isGhAbsent(err) ? 'gh is not installed or not on PATH'
  : err instanceof SyntaxError ? 'response is not JSON' : errorText(err));

// One run's jobs, paged; throws on a failed or malformed page.
function readJobs({ owner, repo, id }, { runner, outOfTime }) {
  const jobs = [];
  let total = null;
  for (let n = 1; n <= MAX_JOB_PAGES; n += 1) {
    if (n > 1 && outOfTime()) return { jobs, cut: `jobs of run ${id}: ${jobs.length} of ${total} jobs read (deadline)` };
    const args = [
      'api', '--method', 'GET', `repos/${owner}/${repo}/actions/runs/${id}/jobs`,
      '-f', 'filter=latest', '-f', `per_page=${JOBS_PER_PAGE}`, '-f', `page=${n}`,
    ];
    const body = parseBody(runner(args, { timeout: CI_HEALTH_GH_TIMEOUT_MS }));
    const page = body && body.jobs;
    if (!Array.isArray(page)) throw new Error(`page ${n}: response has no jobs array`);
    if (Number.isFinite(body.total_count)) total = body.total_count;
    jobs.push(...page);
    if (page.length < JOBS_PER_PAGE || (total !== null && jobs.length >= total)) return { jobs, cut: null };
    if (total === null) return { jobs, cut: `jobs of run ${id}: ${jobs.length} jobs read, total unknown (no total_count on a full page)` };
  }
  return { jobs, cut: jobs.length < total ? `jobs of run ${id}: ${jobs.length} of ${total} jobs read (page cap)` : null };
}

const createdMs = (r) => { const ms = Date.parse(r && r.created_at); return Number.isFinite(ms) ? ms : -Infinity; };
const newestFirst = (a, b) => createdMs(b) - createdMs(a) || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0);

function readRunData({
  runner, repo, listing, days = DEFAULT_DAYS, maxRuns = DEFAULT_MAX_RUNS, workflow = null, now = null, clock = null,
} = {}) {
  const unsampled = { skipped: 0, neverRun: 0 };
  const result = { ok: false, cliAbsent: false, runs: [], truncated: [], failures: [], unsampled, workflow: null, empty: null };
  const refuse = (message) => { result.failures.push(message); return result; };
  if (!validRepo(repo)) return refuse(`repo ${JSON.stringify(repo)} is not owner/name`);
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > MAX_RUNS) return refuse(`maxRuns must be an integer from 1 to ${MAX_RUNS}`);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return refuse(`days must be an integer from 1 to ${MAX_DAYS}`);
  if (now !== null && !(now instanceof Date && Number.isFinite(now.getTime()))) return refuse('now must be a valid Date');
  const wanted = workflow === null ? null : normPath(workflow);
  if (workflow !== null && wanted === null) return refuse(`workflow ${JSON.stringify(workflow)} is not a workflow file path`);
  if (!listing || listing.ok !== true || !Array.isArray(listing.workflows)) {
    return refuse(`workflow files: ${listing && typeof listing.error === 'string' ? listing.error : 'not listed'}`);
  }
  let files = listing.workflows.map((w) => w && w.file).filter((f) => typeof f === 'string');
  if (files.length === 0) { result.ok = true; result.empty = NO_WORKFLOW_FILES; return result; }
  if (wanted !== null) {
    // A full checkout-relative path, or a bare file name (`test.yml`).
    files = files.filter((f) => f === wanted || f.endsWith(`/${wanted}`));
    if (files.length === 0) {
      result.ok = true;
      result.empty = `workflow filter ${JSON.stringify(workflow)} matched no workflow file in ${WORKFLOW_DIR}`;
      return result;
    }
    result.workflow = files.length === 1 ? files[0] : null;
  }

  const [owner, name] = repo.split('/');
  const nowDate = now || new Date();
  const fromDay = new Date(nowDate.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  const deadlineMs = clock === null ? Infinity : clock() + CI_HEALTH_DEADLINE_MS;
  const listDeadlineMs = deadlineMs - JOBS_RESERVE_MS;
  const outOfTime = (limit) => clock !== null && clock() + CI_HEALTH_GH_TIMEOUT_MS > limit;
  let calls = 0;
  let listed = false;
  const notFound = []; // listed files the forge answers 404 for

  const picked = [];
  for (const file of files) {
    const id = file.slice(file.lastIndexOf('/') + 1);
    if (!FILE_RE.test(id)) { result.failures.push(`runs of ${file}: not a plain file name — not read`); continue; }
    const usable = [];
    const seen = new Set();
    let complete = false;
    let cut = null;
    for (let n = 1; n <= MAX_RUN_PAGES; n += 1) {
      if (outOfTime(listDeadlineMs)) { cut = 'deadline'; break; }
      const args = [
        'api', '--method', 'GET', `repos/${owner}/${name}/actions/workflows/${id}/runs`,
        '-f', `created=>=${fromDay}`, '-f', 'status=completed', '-f', 'exclude_pull_requests=true',
        '-f', `per_page=${RUNS_PER_PAGE}`, '-f', `page=${n}`,
      ];
      let page;
      try {
        calls += 1;
        const body = parseBody(runner(args, { timeout: CI_HEALTH_GH_TIMEOUT_MS }));
        page = body && body.workflow_runs;
        if (!Array.isArray(page)) throw new Error('response has no workflow_runs array');
      } catch (err) {
        if (calls === 1 && isGhAbsent(err)) {
          result.cliAbsent = true;
          result.failures.push(GH_ABSENT);
          return result;
        }
        // A 404 on page 1 for a file the checkout holds: the forge has never run that workflow.
        if (n === 1 && httpStatusOf(err) === 404) notFound.push(file);
        else result.failures.push(`runs of ${file} page ${n}: ${whyOf(err)}`);
        complete = true; // reported as a failure or never-run, not as truncation
        break;
      }
      listed = true;
      for (const run of page) {
        if (!run || run.status !== 'completed') continue;
        if (run.id != null) {
          if (seen.has(run.id)) continue;
          seen.add(run.id);
        }
        if (NO_WORK_CONCLUSIONS.includes(run.conclusion)) { unsampled.skipped += 1; continue; }
        usable.push(run);
      }
      if (usable.length >= maxRuns || page.length < RUNS_PER_PAGE) { complete = true; break; }
    }
    if (!complete && usable.length < maxRuns) {
      result.truncated.push(cut === 'deadline'
        ? `runs of ${file}: ${plural(usable.length, 'run', 'runs')} listed before the deadline (fewer than ${maxRuns})`
        : `runs of ${file}: ${plural(usable.length, 'run', 'runs')} in ${MAX_RUN_PAGES} pages (page cap; fewer than ${maxRuns})`);
    }
    picked.push({ file, runs: usable.sort(newestFirst).slice(0, maxRuns) });
  }
  // Every list call 404: the repository itself may be wrong, so it stays a failure, never empty.
  if (!listed) {
    for (const f of notFound) result.failures.push(`runs of ${f} page 1: not found (HTTP 404)`);
    return result;
  }
  unsampled.neverRun = notFound.length;

  const order = [];
  for (let i = 0; picked.some((p) => i < p.runs.length); i++) {
    for (const p of picked) if (i < p.runs.length) order.push({ file: p.file, run: p.runs[i] });
  }
  const sample = order.slice(0, MAX_TOTAL_RUNS);
  if (order.length > sample.length) {
    result.truncated.push(`${plural(order.length - sample.length, 'listed run', 'listed runs')} not sampled: the ${MAX_TOTAL_RUNS}-run overall bound`);
  }

  const unread = new Map(); // file -> runs the deadline left unread
  let failStreak = 0; // consecutive failed jobs reads: a dead forge or token fails every run alike
  for (let i = 0; i < sample.length; i += 1) {
    const { file, run } = sample[i];
    const { id } = run;
    if (!Number.isSafeInteger(id) || id < 1) {
      result.failures.push(`run ${JSON.stringify(id)}: not a run id — excluded`);
      continue;
    }
    if (outOfTime(deadlineMs)) { unread.set(file, (unread.get(file) || 0) + 1); continue; }
    let read;
    try {
      read = readJobs({ owner, repo: name, id }, { runner, outOfTime: () => outOfTime(deadlineMs) });
    } catch (err) {
      result.failures.push(`jobs of run ${id}: ${whyOf(err)}`);
      failStreak += 1;
      if (failStreak >= MAX_JOB_FAIL_STREAK) {
        const left = sample.length - (i + 1);
        if (left > 0) result.truncated.push(`jobs of ${plural(left, 'sampled run', 'sampled runs')}: not read (stopped after ${MAX_JOB_FAIL_STREAK} consecutive failed jobs reads)`);
        break;
      }
      continue;
    }
    failStreak = 0;
    if (read.cut) result.truncated.push(read.cut);
    result.runs.push({ id, workflow: file, conclusion: str(run.conclusion), createdAt: str(run.created_at), jobs: read.jobs.map(normJob) });
  }
  for (const [file, n] of unread) result.truncated.push(`jobs of ${plural(n, 'sampled run', 'sampled runs')} of ${file}: not read (deadline)`);
  result.ok = sample.length === 0 || result.runs.length > 0;
  return result;
}

// -> { slug } | { error }; the host is pinned for the repository either way, so a --root checkout
// on another host than the current directory's still reaches its own.
function resolveRepo({ repo = null, root = null } = {}, deps = {}) {
  const remoteUrl = deps.remoteUrl || ((r) => originUrl(r || (typeof deps.cwd === 'function' ? deps.cwd() : process.cwd())));
  const pinHost = deps.pinHost || ((spec) => pinExplicitRepoHost(spec));
  let spec;
  if (repo !== null) {
    if (!validRepo(repo)) return { error: `repository ${JSON.stringify(repo)} is not owner/name` };
    const [owner, name] = repo.split('/');
    spec = { owner, repo: name };
  } else {
    const where = root === null ? '' : ` of ${JSON.stringify(root)}`;
    let url;
    try {
      url = remoteUrl(root);
    } catch (err) {
      return { error: `no --repo and origin remote${where} unreadable: ${oneLine(errorText(err))}` };
    }
    const gated = gateOriginRepo(url, deps.gateDeps);
    if (gated.refusal) return { error: gated.refusal };
    if (!gated.spec) return { error: `no --repo and origin remote${where} names no GitHub repository — pass --repo <owner/name>` };
    spec = { host: gated.spec.host, owner: gated.spec.owner, repo: gated.spec.repo };
    if (!validRepo(`${spec.owner}/${spec.repo}`)) return { error: 'origin remote resolves to an unusable owner/name — pass --repo <owner/name>' };
  }
  try {
    pinHost(spec);
  } catch (err) {
    return { error: `could not pin the repository host: ${oneLine(errorText(err))}` };
  }
  return { slug: `${spec.owner}/${spec.repo}` };
}

// The real runner over `spawn` (execFileSync by default), so a test can record the options.
function makeRunner(spawn = execFileSync) {
  return (args, opts = {}) => spawn('gh', args, ghOptions(args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeout || CI_HEALTH_GH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true,
  }));
}

function readWorkflowFiles(root, deps = {}) {
  const set = readWorkflowSet(root, deps);
  if (!set.ok) return { ok: false, workflows: [], error: set.error };
  return {
    ok: true,
    workflows: set.workflows.map((w) => (typeof w.text === 'string'
      ? { file: w.workflow, text: w.text.replace(/\r\n/g, '\n') }
      : { file: w.workflow, unreadable: w.unreadable })),
  };
}

module.exports = {
  readRunData, readWorkflowFiles, makeRunner, resolveRepo, validRepo, stepRunName, withRunNames,
  DEFAULT_MAX_RUNS, MAX_RUNS, MAX_TOTAL_RUNS, MAX_RUN_PAGES, MAX_JOB_PAGES, DEFAULT_DAYS, MAX_DAYS, NO_WORKFLOW_FILES,
};
