// plugin/bin/lib/ci-audit/source.js — /claude-tweaks:ci-health's (#5757) one source adapter: the
// only ci-audit module that names a forge (GitHub Actions), a forge CLI (`gh`), a workflow-file
// location (`.github/workflows`) or spawns a process. It maps what the forge returns onto the
// vendor-neutral shape every other ci-audit module consumes, and reads nothing but run data and
// the workflow files. It never writes, never files, never edits a workflow.
//
//   NormRun = { id, workflow, conclusion, createdAt, jobs: NormJob[] }
//   NormJob = { name, createdAt, startedAt, completedAt, conclusion,
//               steps: [{ name, number, startedAt, completedAt }] }
// Instants are the forge's ISO-8601 strings, passed through unparsed (a non-string reads as null);
// every forge field the shape does not name is dropped here and nowhere else.
//
// Field mapping (GitHub REST, probed against a real repository on 2026-11-16):
//  - NormRun.workflow is the run's `path` (`.github/workflows/test.yml`), backslashes turned to
//    forward slashes and a leading `./` dropped: the checkout-relative file path, the one key the
//    workflow facts, the `--workflow` filter and findings share. A run with no usable `path` (absent,
//    not a string, empty) is excluded and counted in one failure line, never given a guessed key.
//    A run whose path lies outside `.github/workflows/` (the forge's `dynamic/…` workflows, such as
//    dependabot's) has no workflow file in the checkout, so nothing the audit says could change it:
//    it is not sampled, and that is no failure.
//  - NormJob.createdAt is the job's `created_at`, the instant the job became runnable (queued). For a
//    job with `needs` the forge creates it when its dependencies finish, so this holds for dependent
//    jobs too: on the probed run, `test` (needs the `shard` matrix) had created_at 16:14:02, equal
//    to the last shard's completed_at, and started_at 16:14:08. The aggregate's critical path
//    (created→completed per job, summed along `needs`) relies on that; no adjustment is made.
//  - Steps map name, number, started_at, completed_at; a non-array `steps` reads as [].
//
// readRunData reads the window through fetch.js's fetchRuns (newest 7-day range first), keeps the
// completed runs whose conclusion did work (ci-health's NO_WORK_CONCLUSIONS, `skipped`, are left
// out: they carry no job timings), applies the `workflow` filter, sorts newest first by createdAt
// (then id) and samples the most recent `maxRuns` (DEFAULT_MAX_RUNS, at most MAX_RUNS). Each
// sampled run's jobs are one `actions/runs/{id}/jobs` read per page (`filter=latest`, 100 a page,
// at most MAX_JOB_PAGES pages; a run past the cap keeps what was read and is named in `truncated`).
// A failed or malformed jobs read excludes that run and adds one failure line; a body that is not
// JSON reads `response is not JSON`, so no response byte reaches `failures`.
// -> { ok, cliAbsent, runs, truncated, failures, unsampled }, `truncated`/`failures` plain strings:
//  - cliAbsent: the first call threw ENOENT (fetch.js's ghAbsent); one failure line names gh absent.
//    gh vanishing after it answered the listing is a failed jobs read, and cliAbsent stays false.
//  - ok false: no runs page was read (gh absent included), or runs were sampled but no run's jobs
//    were read (every jobs read failed, or the deadline left them all unread: failures may then
//    be empty, truncated names each), or an invalid input refused before any call with one
//    failure line (repo not owner/name; maxRuns not an integer 1..MAX_RUNS; days not an integer
//    1..MAX_DAYS; now not a valid Date; a non-null workflow that normalizes to no path). A read
//    that succeeds with zero sampled runs is ok:true, runs:[]; a failed read never looks clean.
//  - truncated: each runs range fetchRuns names (`runs {from}..{to}: cap|budget`), each jobs read the
//    deadline left unread, each run cut at the jobs page cap, and each run whose full jobs page
//    came without a total_count (paging stops there: how many jobs remain is unknown). Sampling to
//    maxRuns is the requested sample, not truncation, and is not listed.
//  - unsampled: always present, zeros when none — the completed runs left out before sampling,
//    so an empty sample can say why: `skipped` (a NO_WORK conclusion), `noWorkflowPath` (also
//    kept as its failure line) and `outsideWorkflows` (a path outside `.github/workflows/`).
//    In-progress runs and runs the `workflow` filter leaves out are not counted.
//
// Bounds: every call passes { timeout: CI_HEALTH_GH_TIMEOUT_MS } (ci-health's 15 s github.com read
// bound, for the same several-MiB `actions/runs` pages) and `--method GET` on a literal `repos/`
// path, so no value reads as a flag; owner/name is validated here (no leading `-`, no `.`/`..`
// segment) and a run id must be a positive safe integer before it reaches a path. With a `clock`
// (epoch ms), the whole read keeps inside CI_HEALTH_DEADLINE_MS from its first call: the runs read
// stops early enough to leave maxRuns jobs reads their worst case, and no jobs read starts that
// could end past the deadline. MAX_RUNS (30 × 15 s = 450 s) leaves the runs read 120 s at worst.
// makeRunner(spawn) is the real runner: gh through repo-resolve.js's ghOptions (an explicit
// `--repo` host the CLI pinned with pinExplicitRepoHost reaches every call), windowsHide, piped
// stdio, LARGE_MAX_BUFFER_BYTES and the caller's timeout (else the shared bound).
// readWorkflowFiles(root) is init's readWorkflowSet (path-guarded, symlinks out of the checkout
// refused), keyed `file`, with CRLF line endings read as LF so a Windows checkout parses the same.
'use strict';

const { execFileSync } = require('child_process');
const { ghOptions } = require('../repo-resolve');
const { LARGE_MAX_BUFFER_BYTES } = require('../shared-primitives');
const { fetchRuns, errorText, isGhAbsent, parseBody } = require('../ci-health/fetch');
const {
  CI_HEALTH_GH_TIMEOUT_MS, CI_HEALTH_DEADLINE_MS, DEFAULT_DAYS, MAX_DAYS, NO_WORK_CONCLUSIONS,
} = require('../ci-health/constants');
const { readWorkflowSet } = require('../init/ci-workflow-review');

const DEFAULT_MAX_RUNS = 20;
const MAX_RUNS = 30;
const JOBS_PER_PAGE = 100;
const MAX_JOB_PAGES = 3;
const WORKFLOW_DIR = '.github/workflows/';
const DAY_MS = 24 * 60 * 60 * 1000;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;

const GH_ABSENT = 'gh (the GitHub CLI) is not installed or not on PATH — no run data read';

const str = (v) => (typeof v === 'string' ? v : null);

function validRepo(slug) {
  return typeof slug === 'string' && REPO_RE.test(slug) && slug.split('/').every((s) => s !== '.' && s !== '..');
}

function normPath(p) {
  if (typeof p !== 'string' || p === '') return null;
  const s = p.replace(/\\/g, '/').replace(/^\.\//, '');
  return /[^/.]/.test(s) ? s : null;
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
        startedAt: str(s && s.started_at),
        completedAt: str(s && s.completed_at),
      }))
      : [],
  };
}

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
    if (body && Number.isFinite(body.total_count)) total = body.total_count;
    jobs.push(...page);
    if (page.length < JOBS_PER_PAGE || (total !== null && jobs.length >= total)) return { jobs, cut: null };
    if (total === null) return { jobs, cut: `jobs of run ${id}: ${jobs.length} jobs read, total unknown (no total_count on a full page)` };
  }
  return { jobs, cut: jobs.length < total ? `jobs of run ${id}: ${jobs.length} of ${total} jobs read (page cap)` : null };
}

function readRunData({ runner, repo, days = DEFAULT_DAYS, maxRuns = DEFAULT_MAX_RUNS, workflow = null, now = null, clock = null } = {}) {
  const unsampled = { skipped: 0, outsideWorkflows: 0, noWorkflowPath: 0 };
  const result = { ok: false, cliAbsent: false, runs: [], truncated: [], failures: [], unsampled };
  const refuse = (message) => { result.failures.push(message); return result; };
  if (!validRepo(repo)) return refuse(`repo ${JSON.stringify(repo)} is not owner/name`);
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > MAX_RUNS) return refuse(`maxRuns must be an integer from 1 to ${MAX_RUNS}`);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return refuse(`days must be an integer from 1 to ${MAX_DAYS}`);
  if (now !== null && !(now instanceof Date && Number.isFinite(now.getTime()))) return refuse('now must be a valid Date');
  const wanted = workflow === null ? null : normPath(workflow);
  if (workflow !== null && wanted === null) return refuse(`workflow ${JSON.stringify(workflow)} is not a workflow file path`);
  const [owner, name] = repo.split('/');
  const nowDate = now || new Date();
  const from = new Date(`${new Date(nowDate.getTime() - days * DAY_MS).toISOString().slice(0, 10)}T00:00:00Z`);
  const deadlineMs = clock === null ? Infinity : clock() + CI_HEALTH_DEADLINE_MS;
  const runsDeadlineMs = deadlineMs - maxRuns * CI_HEALTH_GH_TIMEOUT_MS;
  const outOfTime = () => clock !== null && clock() + CI_HEALTH_GH_TIMEOUT_MS > deadlineMs;

  const listed = fetchRuns({ owner, repo: name, from, days }, { runner, clock, runsDeadlineMs });
  result.cliAbsent = listed.ghAbsent;
  if (listed.ghAbsent) result.failures.push(GH_ABSENT);
  for (const f of listed.failures) result.failures.push(`${f.query}: ${f.error}`);
  for (const t of listed.truncatedRanges) result.truncated.push(`runs ${t.from}..${t.to}: ${t.reason}`);
  if (!listed.available) return result;

  const pool = [];
  for (const run of listed.runs) {
    if (!run || run.status !== 'completed') continue;
    if (NO_WORK_CONCLUSIONS.includes(run.conclusion)) { unsampled.skipped += 1; continue; }
    const wf = normPath(run.path);
    if (wf === null) { unsampled.noWorkflowPath += 1; continue; }
    if (!wf.startsWith(WORKFLOW_DIR)) { unsampled.outsideWorkflows += 1; continue; }
    if (wanted !== null && wf !== wanted) continue;
    pool.push({ run, wf });
  }
  const pathless = unsampled.noWorkflowPath;
  if (pathless > 0) result.failures.push(`${pathless} ${pathless === 1 ? 'run carries' : 'runs carry'} no workflow path — excluded`);
  const createdMs = (r) => { const ms = Date.parse(r.created_at); return Number.isFinite(ms) ? ms : -Infinity; };
  pool.sort((a, b) => createdMs(b.run) - createdMs(a.run) || (b.run.id > a.run.id ? 1 : b.run.id < a.run.id ? -1 : 0));
  const sample = pool.slice(0, maxRuns);

  for (const { run, wf } of sample) {
    const { id } = run;
    if (!Number.isSafeInteger(id) || id < 1) {
      result.failures.push(`run ${JSON.stringify(id)}: not a run id — excluded`);
      continue;
    }
    if (outOfTime()) { result.truncated.push(`jobs of run ${id}: not read (deadline)`); continue; }
    let read;
    try {
      read = readJobs({ owner, repo: name, id }, { runner, outOfTime });
    } catch (err) {
      // JSON.parse's message quotes the body's opening bytes, so a parse failure gets fixed text.
      const why = isGhAbsent(err) ? 'gh is not installed or not on PATH'
        : err instanceof SyntaxError ? 'response is not JSON' : errorText(err);
      result.failures.push(`jobs of run ${id}: ${why}`);
      continue;
    }
    if (read.cut) result.truncated.push(read.cut);
    result.runs.push({ id, workflow: wf, conclusion: str(run.conclusion), createdAt: str(run.created_at), jobs: read.jobs.map(normJob) });
  }
  result.ok = sample.length === 0 || result.runs.length > 0;
  return result;
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

module.exports = { readRunData, readWorkflowFiles, makeRunner, DEFAULT_MAX_RUNS, MAX_RUNS, MAX_JOB_PAGES };
