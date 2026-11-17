#!/usr/bin/env node
// bin/ci-audit.js — /claude-tweaks:ci-health's (#5757) CLI. `gather` reads the workflow files and
// recent run data through lib/ci-audit/source.js (the one module that knows the forge, resolves
// the repository and its host, and spawns), splits each job into waiting, setup and running time,
// aggregates the figures across runs and runs the mechanical checks, then prints every measured
// fact as one JSON line. Report-only: it never edits a workflow file or any CI setting, never files
// anything, and starts no process itself. Text the adapter returns (a refusal, a failure, a
// truncation line, an empty-read reason) is relayed as given.
// Logic lives in run(argv, deps); every side effect (runner, readWorkflowFiles, cwd, now, clock,
// stdout, stderr, and the adapter's repository-resolution deps remoteUrl, pinHost, gateDeps) is
// injected so tests never touch the forge. `now` (a Date, else the current time) dates the window;
// `clock()` (epoch ms) times the read against the adapter's deadline.
//
// Usage: ci-audit.js gather [--days N] [--runs N] [--workflow <file>] [--repo owner/name | --root <dir>]
//                           [--min-sample N] [--thresholds <text>]
//        ci-audit.js validate-findings --gather <file> --findings <file> --issues <file> [--dry-run]
//        ci-audit.js --help|-h
//   --days N            window length, an integer 1..400 (default 30), starting at the UTC date
//                       N days before now
//   --runs N            the most recent completed runs sampled per workflow file, an integer 1..30
//                       (default 20; the adapter also bounds the sample across all workflows)
//   --workflow <file>   sample only this workflow file (its checkout-relative path or file name)
//   --repo owner/name   the repository to read (default: the origin remote); its host is pinned
//                       for every read
//   --root <dir>        the checkout whose origin names the repository and whose workflow files
//                       are read, instead of the current directory. Never with --repo, which would
//                       name the repository a second way
//   --min-sample N      the fewest runs a job needs before any check judges it, an integer 1..30
//                       (default checks.js's DEFAULT_MIN_SAMPLE, 5)
//   --thresholds <text> comma-separated `id=number` overrides of the checks' thresholds and floors
//   Each flag at most once: a repeated flag is a usage error, never a silent overwrite.
// Time budget: the source adapter bounds the whole read at 570 s, so the caller's command timeout
// must be at least 600000 ms.
//
// Output (one JSON line): { definitions, window, workflows: [{file, unparsed}], jobs, criticalPaths,
// shardSkews, repeatedSteps, overlaps, breaches, underSampled, unmatchedJobs, droppedBreaches,
// excluded, notTimed, truncated, failures, unsampled, noData }.
// `window` is {days, from, maxRuns, workflow, minSample, thresholds, sampledRuns}: `minSample` is
// the floor actually applied (the flag, else the default, never null), `thresholds` every check
// threshold and absolute floor actually applied (checks.js's limitsOf), `workflow` the file the
// filter matched (else the filter as given, or null), and `from` the window's first UTC day (null
// when an injected `now` was invalid and the read refused it). `underSampled` lists {workflow,
// job, runs} for every job with fewer runs than `minSample` (no check judged it), sorted by
// workflow then job, so too few runs never reads as clean. `unmatchedJobs` lists {workflow, job}
// for every run job no workflow job matched: no workflow-file check reached it, so it is
// unchecked, never clean. `notTimed` counts the skipped and cancelled jobs left out of every
// figure. `workflows` lists every workflow file found, a file that could not be read carrying its
// reason in `unparsed`; a workflow with any `unparsed` reason is never judged, so its breaches are
// dropped and counted in `droppedBreaches`. `truncated`, `failures` and `unsampled` render whatever
// the read's outcome; `truncated` holds only what could have changed the sample. `noData` is
// {reason} when the read succeeded but no run was sampled (no workflow files, a filter matching
// none, no completed run that did work, workflow files never run: unsampled.neverRun), the sampled
// runs had no jobs, or no job was timed, else
// null: an empty sample is never a clean report.
// Exit codes (gather's 0/2/3 matches none of the exit-code families in the repo's CLI wrapper
// contract, cli-wrapper-contract.md in its module-pattern skill, deliberately: the status is the
// skill's Step 1 table input, where 2 must separate "no report" from "a report of a failed read"
// by whether stdout holds one, and 3 names the absent forge CLI; validate-findings below uses
// 0/1/2):
//   0 report printed — partial allowed (failures, truncated lines, noData)
//   2 malformed invocation, an unusable origin or host pin (one stderr line, nothing on stdout), or
//     the read failed (the workflow files could not be listed, no runs page was read, or no
//     sampled run's jobs were read): the report still goes to stdout so nothing read is lost
//   3 the forge CLI is absent: the report goes to stdout with the failure naming it
//
// validate-findings: the judge's findings (a JSON array, --findings) checked against the gather
// report they cite (--gather) by lib/ci-audit/validate-finding.js, fingerprinted
// (lib/ci-audit/fingerprint.js), collapsed within the batch (the first finding per fingerprint
// wins), deduplicated against the open and closed by:ci-health issues (--issues: a JSON array of
// {number, state, labels, fingerprint}, parsed here, indexed by health-core's buildIssueIndex; `[]` when none exist)
// through health-core's decide with no local cache, and projected into born-ready payloads
// (lib/ci-audit/issue-payload.js). An open match is skipped, a `wontfix` match suppressed, a
// closed match reopened. Emit-only: it reads its three files and nothing else, starts no process
// and writes no file, whether or not --dry-run is given; the skill files the payloads.
//   --dry-run  marks each payload `dryRun: true`; nothing else changes
// Output: one JSON line, an array of {id, check, workflow, job, step, action: file|reopen,
// reopens: issue number|null, origin, title, body, labels, type[, dryRun]}. stderr carries one line
// per rejection reason (`finding <index> ("<check>") rejected: <reason>`) and a closing count line.
// Exit codes:
//   0 payloads printed (possibly none), no finding rejected
//   1 at least one finding rejected: the valid ones' payloads still print
//   2 malformed invocation, or a file that cannot be read or parsed, a --gather that is not a
//     gather report, or a --findings or --issues that is not a JSON array (one stderr line,
//     nothing on stdout)
'use strict';

const fs = require('fs');

const source = require('./lib/ci-audit/source');
const { readWorkflowFacts } = require('./lib/ci-audit/workflow-facts');
const { aggregate } = require('./lib/ci-audit/aggregate');
const { CHECK_IDS, DEFAULT_MIN_SAMPLE, parseThresholds, limitsOf, evaluate } = require('./lib/ci-audit/checks');
const { validateFinding } = require('./lib/ci-audit/validate-finding');
const { fingerprint } = require('./lib/ci-audit/fingerprint');
const { toIssuePayload } = require('./lib/ci-audit/issue-payload');
const { buildIssueIndex } = require('./lib/health-core/issue-index');
const { decide } = require('./lib/health-core/dedup');

const { DEFAULT_MAX_RUNS, MAX_RUNS, DEFAULT_DAYS, MAX_DAYS } = source;

const USAGE = 'usage: ci-audit.js gather [--days N] [--runs N] [--workflow <file>] [--repo owner/name | --root <dir>] [--min-sample N] [--thresholds <text>]\n'
  + '       ci-audit.js validate-findings --gather <file> --findings <file> --issues <file> [--dry-run]\n'
  + '       ci-audit.js --help|-h\n';

// The phase definitions, verbatim from plugin/skills/ci-health/checklist.md's phase definitions;
// tests/bin-lib/ci-audit/skill-md.test.js pins the two equal.
const DEFINITIONS = Object.freeze({
  waiting: 'job started − job created',
  setup: 'job started → start of the first step the workflow file declares as a command (steps with no declaration count as setup when they precede it)',
  running: 'that boundary → job completed',
});

const DAY_MS = 24 * 60 * 60 * 1000;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The argument after the flag at index i when it is a value (not empty, not another flag), else null.
function flagValue(argv, i) {
  const v = argv[i + 1];
  return typeof v === 'string' && v !== '' && !v.startsWith('--') ? v : null;
}

function parseArgs(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { help: true };
  if (argv[0] !== 'gather') return { error: argv.length === 0 ? 'missing verb: gather or validate-findings' : `unknown verb: ${JSON.stringify(argv[0])}` };
  const o = { days: DEFAULT_DAYS, maxRuns: DEFAULT_MAX_RUNS, workflow: null, repo: null, root: null, minSample: null, thresholds: {} };
  const int = (v, lo, hi) => (v !== null && /^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);
  const seen = new Set();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (seen.has(a)) return { error: `${a} given twice` };
    seen.add(a);
    const next = () => {
      const v = flagValue(argv, i);
      if (v !== null) i += 1;
      return v;
    };
    if (a === '--days') {
      o.days = int(next(), 1, MAX_DAYS);
      if (o.days === null) return { error: `--days takes an integer from 1 to ${MAX_DAYS}` };
    } else if (a === '--runs') {
      o.maxRuns = int(next(), 1, MAX_RUNS);
      if (o.maxRuns === null) return { error: `--runs takes an integer from 1 to ${MAX_RUNS}` };
    } else if (a === '--min-sample') {
      o.minSample = int(next(), 1, MAX_RUNS);
      if (o.minSample === null) return { error: `--min-sample takes an integer from 1 to ${MAX_RUNS}` };
    } else if (a === '--workflow') {
      o.workflow = next();
      if (o.workflow === null) return { error: '--workflow requires a workflow file path' };
    } else if (a === '--repo') {
      const v = next();
      if (v === null) return { error: '--repo requires a value' };
      // owner/name only, no `.`/`..` segment: the adapter interpolates both into request paths.
      if (!source.validRepo(v)) return { error: `--repo ${JSON.stringify(v)} must be owner/name` };
      o.repo = v;
    } else if (a === '--root') {
      const v = next();
      if (v === null || !v.trim()) return { error: '--root requires a directory' };
      o.root = v;
    } else if (a === '--thresholds') {
      const v = next();
      if (v === null) return { error: '--thresholds requires a value' };
      const parsed = parseThresholds(v);
      if (!parsed.ok) return { error: `--thresholds: ${parsed.error}` };
      o.thresholds = parsed.values;
    } else return { error: `unknown argument: ${JSON.stringify(a)}` };
  }
  if (o.repo !== null && o.root !== null) return { error: '--repo and --root each name the repository: pass one' };
  return o;
}

// The repository-resolution deps (remoteUrl, pinHost, gateDeps) are the adapter's own defaults.
const realDeps = {
  runner: source.makeRunner(),
  readWorkflowFiles: (root) => source.readWorkflowFiles(root),
  cwd: () => process.cwd(),
  now: null,
  clock: () => Date.now(),
  readFile: (file) => fs.readFileSync(file, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// Facts per workflow file, each step given its run-data name by the adapter; a file that could
// not be read is an unparsed entry, never omitted.
function workflowFacts(listing) {
  const factsByWorkflow = {};
  const workflows = [];
  for (const w of listing.ok ? listing.workflows : []) {
    const facts = typeof w.text === 'string'
      ? source.withRunNames(readWorkflowFacts(w.text))
      : { jobs: [], concurrencyDeclared: false, unparsed: [w.unreadable] };
    factsByWorkflow[w.file] = facts;
    workflows.push({ file: w.file, unparsed: facts.unparsed });
  }
  return { factsByWorkflow, workflows };
}

function noDataReason(o, read, agg) {
  if (read.empty !== null) return read.empty;
  if (read.runs.length > 0) {
    if (agg.jobs.length > 0) return null;
    const runs = plural(read.runs.length, 'sampled run', 'sampled runs');
    const noJobs = read.runs.filter((r) => r.jobs.length === 0).length;
    if (noJobs === read.runs.length) return `the ${runs} had no jobs`;
    const why = [];
    if (noJobs > 0) why.push(`${plural(noJobs, 'run', 'runs')} of them had no jobs`);
    if (agg.excluded > 0) why.push(`${plural(agg.excluded, 'job', 'jobs')} excluded (a missing or out-of-order instant)`);
    if (agg.notTimed.skipped > 0) why.push(`${plural(agg.notTimed.skipped, 'job was', 'jobs were')} skipped`);
    if (agg.notTimed.cancelled > 0) why.push(`${plural(agg.notTimed.cancelled, 'job was', 'jobs were')} cancelled`);
    return `the ${runs} gave no job with phases: ${why.join('; ')}`;
  }
  const { skipped, neverRun } = read.unsampled;
  const filter = o.workflow === null ? '' : ` for workflow ${JSON.stringify(o.workflow)}`;
  const why = [];
  if (skipped > 0) why.push(`${plural(skipped, 'run did', 'runs did')} no work (skipped)`);
  if (neverRun > 0) why.push(`${plural(neverRun, 'workflow file has', 'workflow files have')} never run`);
  return `no completed run was sampled in the ${o.days}-day window${filter}`
    + (why.length > 0 ? `: ${why.join('; ')}` : '')
    + (read.truncated.length > 0 ? ' — the window was truncated (see truncated)' : '')
    + (read.failures.length > 0 ? ' — part of the read failed (see failures), so the window may not be empty' : '');
}

const VALUE_FLAGS = { '--gather': 'gather', '--findings': 'findings', '--issues': 'issues' };

function parseValidateArgs(argv) {
  const o = { gather: null, findings: null, issues: null, dryRun: false };
  const seen = new Set();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (seen.has(a)) return { error: `${a} given twice` };
    seen.add(a);
    if (a === '--dry-run') o.dryRun = true;
    else if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, a)) {
      const v = flagValue(argv, i);
      if (v === null) return { error: `${a} requires a file` };
      i += 1;
      o[VALUE_FLAGS[a]] = v;
    } else return { error: `unknown argument: ${JSON.stringify(a)}` };
  }
  if (o.gather === null) return { error: 'validate-findings requires --gather <file>' };
  if (o.findings === null) return { error: 'validate-findings requires --findings <file>' };
  if (o.issues === null) return { error: 'validate-findings requires --issues <file> (an empty JSON array when no by:ci-health issue exists)' };
  return o;
}

const isInt = (v) => Number.isInteger(v) && v >= 0;
const GATHER_LISTS = ['workflows', 'jobs', 'criticalPaths', 'shardSkews', 'repeatedSteps', 'breaches', 'truncated', 'failures'];

// Whether `g` has the gather report's shape where the validator and the payload read it.
function isGather(g) {
  if (g === null || typeof g !== 'object' || Array.isArray(g)) return false;
  if (!GATHER_LISTS.every((k) => Array.isArray(g[k])) || !Object.prototype.hasOwnProperty.call(g, 'noData')) return false;
  const w = g.window;
  return w !== null && typeof w === 'object' && isInt(w.days) && w.days > 0 && isInt(w.minSample) && isInt(w.sampledRuns)
    && (w.from === null || typeof w.from === 'string');
}

function runValidateFindings(argv, deps) {
  const fail = (message) => { deps.stderr(`ci-audit.js: ${message} (see --help)\n`); return 2; };
  const o = parseValidateArgs(argv);
  if (o.error) return fail(o.error);
  const read = (flag, file) => {
    try {
      return { value: JSON.parse(deps.readFile(file)) };
    } catch {
      return { error: `${flag} ${file}: could not read or parse the file` };
    }
  };
  const gather = read('--gather', o.gather);
  if (gather.error) return fail(gather.error);
  if (!isGather(gather.value)) return fail(`--gather ${o.gather}: not a gather report`);
  const inputs = {};
  for (const [flag, key] of [['--findings', 'findings'], ['--issues', 'issues']]) {
    const r = read(flag, o[key]);
    if (r.error) return fail(r.error);
    if (!Array.isArray(r.value)) return fail(`${flag} ${o[key]}: must hold a JSON array`);
    inputs[key] = r.value;
  }

  const say = (line) => deps.stderr(`ci-audit.js: validate-findings: ${line}\n`);
  const survivors = [];
  let rejected = 0;
  inputs.findings.forEach((f, i) => {
    const v = validateFinding(f, gather.value);
    if (v.ok) { survivors.push({ ...v.value, id: fingerprint(v.value) }); return; }
    rejected += 1;
    const check = f && CHECK_IDS.includes(f.check) ? JSON.stringify(f.check) : 'an unknown check';
    for (const e of v.errors) say(`finding ${i} (${check}) rejected: ${e}`);
  });

  // From the array parsed above, never a second read of the path: the injected readFile is the
  // only reader, and a failing second read cannot silently empty the dedup index.
  const index = buildIssueIndex(inputs.issues, 'ci-audit', { stderr: deps.stderr });
  const seen = new Set();
  const payloads = [];
  let collapsed = 0;
  let held = 0;
  for (const finding of survivors) {
    if (seen.has(finding.id)) { collapsed += 1; continue; }
    seen.add(finding.id);
    const decision = decide(finding, index, {});
    if (decision.action !== 'file' && decision.action !== 'reopen') { held += 1; continue; }
    // A reopen with no issue number to reopen cannot be filed as one: held, never `reopens: null`.
    if (decision.action === 'reopen' && !Number.isInteger(decision.issue)) { held += 1; continue; }
    const { id, check, workflow, job, step, ...rest } = toIssuePayload(finding, gather.value, null);
    const payload = {
      id, check, workflow, job, step, action: decision.action,
      reopens: decision.action === 'reopen' ? decision.issue : null, ...rest,
    };
    if (o.dryRun) payload.dryRun = true;
    payloads.push(payload);
  }
  deps.stdout(`${JSON.stringify(payloads)}\n`);
  say(`${inputs.findings.length} finding(s): ${survivors.length} valid, ${rejected} rejected, `
    + `${collapsed} collapsed as duplicates, ${held} already filed or suppressed, ${payloads.length} payload(s)`);
  return rejected > 0 ? 1 : 0;
}

function run(argv, deps = realDeps) {
  if (argv[0] === 'validate-findings') return runValidateFindings(argv, deps);
  const o = parseArgs(argv);
  const fail = (message) => { deps.stderr(`ci-audit.js: ${message}\n`); return 2; };
  if (o.error) return fail(`${o.error} (see --help)`);
  if (o.help) { deps.stdout(USAGE); return 0; }

  // deps carries the adapter's repository-resolution fakes in tests; realDeps carries none.
  const resolved = source.resolveRepo({ repo: o.repo, root: o.root }, deps);
  if (resolved.error) return fail(resolved.error);

  const now = deps.now || new Date();
  const listing = deps.readWorkflowFiles(o.root || deps.cwd());
  const { factsByWorkflow, workflows } = workflowFacts(listing);
  const read = source.readRunData({
    runner: deps.runner, repo: resolved.slug, listing, days: o.days, maxRuns: o.maxRuns, workflow: o.workflow, now, clock: deps.clock || null,
  });

  const minSample = o.minSample === null ? DEFAULT_MIN_SAMPLE : o.minSample;
  const agg = aggregate(read.runs, factsByWorkflow, { minSample });
  // evaluate() skips an unparsed workflow only in the checks that read workflow facts; the checks
  // over run data alone (queue-wait, setup-dominance, shard-skew) still fire for it. Dropping every
  // breach of an unparsed workflow is left to this caller, so `droppedBreaches` can count them.
  const unjudged = new Set(workflows.filter((w) => w.unparsed.length > 0).map((w) => w.file));
  const judged = evaluate(agg, factsByWorkflow, o.thresholds, minSample);
  const breaches = judged.filter((b) => b.workflow === null || !unjudged.has(b.workflow));
  const reason = read.ok ? noDataReason(o, read, agg) : null;
  // An invalid injected `now` is the adapter's refusal (a failure line); the window has no start.
  const validNow = now instanceof Date && Number.isFinite(now.getTime());

  const report = {
    definitions: DEFINITIONS,
    window: {
      days: o.days,
      from: validNow ? new Date(now.getTime() - o.days * DAY_MS).toISOString().slice(0, 10) : null,
      maxRuns: o.maxRuns,
      workflow: read.workflow !== null ? read.workflow : o.workflow,
      minSample,
      thresholds: limitsOf(o.thresholds),
      sampledRuns: read.runs.length,
    },
    workflows,
    jobs: agg.jobs,
    criticalPaths: agg.criticalPaths,
    shardSkews: agg.shardSkews,
    repeatedSteps: agg.repeatedSteps,
    overlaps: agg.overlaps,
    breaches,
    underSampled: agg.jobs.filter((j) => j.runs < minSample).map((j) => ({ workflow: j.workflow, job: j.job, runs: j.runs })),
    unmatchedJobs: agg.unmatchedJobs,
    droppedBreaches: judged.length - breaches.length,
    excluded: agg.excluded,
    notTimed: agg.notTimed,
    truncated: read.truncated,
    failures: read.failures,
    unsampled: read.unsampled,
    noData: reason === null ? null : { reason },
  };
  deps.stdout(`${JSON.stringify(report)}\n`);
  if (read.cliAbsent) return 3;
  return read.ok ? 0 : 2;
}

module.exports = { run, parseArgs, realDeps, USAGE, DEFINITIONS };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
