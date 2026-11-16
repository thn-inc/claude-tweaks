#!/usr/bin/env node
// bin/ci-audit.js — /claude-tweaks:ci-health's (#5757) CLI. `gather` reads recent run data and the
// workflow files through lib/ci-audit/source.js (the one module that knows the forge), splits each
// job into waiting, setup and running time, aggregates the figures across runs and runs the
// mechanical checks, then prints every measured fact as one JSON line. Report-only: it never edits
// a workflow file or any CI setting, never files anything, and starts no process itself (the
// source adapter's runner does every forge read, the origin read is repo-resolve.js's).
// Logic lives in run(argv, deps); every side effect (runner, readWorkflowFiles, remoteUrl, pinHost,
// cwd, now, clock, stdout, stderr) is injected so tests never touch the forge. `now` (a Date, else
// the current time) dates the window; `clock()` (epoch ms) times the read against the adapter's
// deadline.
//
// Usage: ci-audit.js gather [--days N] [--runs N] [--workflow <file>] [--repo owner/name | --root <dir>]
//                           [--min-sample N] [--thresholds <text>]
//        ci-audit.js --help|-h
//   --days N            window length, an integer 1..400 (default 30), starting at the UTC date
//                       N days before now
//   --runs N            the most recent completed runs sampled, an integer 1..30 (default 20)
//   --workflow <file>   sample only runs of this workflow file (its checkout-relative path)
//   --repo owner/name   the repository to read (default: the origin remote); its host is pinned
//                       for every forge read
//   --root <dir>        the checkout whose origin names the repository and whose workflow files
//                       are read, instead of the current directory. Never with --repo, which would
//                       name the repository a second way
//   --min-sample N      the fewest runs a job needs before any check judges it, an integer 1..30
//                       (default 5)
//   --thresholds <text> comma-separated `check-id=number` overrides of the checks' thresholds
// Time budget: the source adapter bounds the whole read at 570 s, so the caller's command timeout
// must be at least 600000 ms.
//
// Output (one JSON line): { definitions, window, workflows: [{file, unparsed}], jobs, criticalPaths,
// shardSkews, repeatedSteps, overlaps, breaches, excluded, truncated, failures, unsampled, noData }.
// `workflows` lists every workflow file found, a file that could not be read carrying its reason in
// `unparsed`; a workflow with any `unparsed` reason is never judged, so none of its breaches is
// kept. `truncated`, `failures` and `unsampled` render whatever the read's outcome. `noData` is
// {reason} when the read succeeded but no run was sampled or every job was excluded, else null:
// an empty sample is never a clean report.
// Exit codes:
//   0 report printed — partial allowed (failures, truncated ranges, noData)
//   2 malformed invocation, an unusable origin or host pin (one stderr line, nothing on stdout), or
//     the run data read failed (no runs page read, or every sampled run's jobs read failed): the
//     report still goes to stdout so nothing read is lost
//   3 the forge CLI is absent: the report goes to stdout with the failure naming it
'use strict';

const { originUrl, gateOriginRepo, pinExplicitRepoHost } = require('./lib/repo-resolve');
const { DEFAULT_DAYS, MAX_DAYS } = require('./lib/ci-health/constants');
const { errorText } = require('./lib/ci-health/fetch');
const { oneLine } = require('./lib/ci-health/render');
const source = require('./lib/ci-audit/source');
const { readWorkflowFacts } = require('./lib/ci-audit/workflow-facts');
const { aggregate } = require('./lib/ci-audit/aggregate');
const { parseThresholds, evaluate } = require('./lib/ci-audit/checks');

const { DEFAULT_MAX_RUNS, MAX_RUNS } = source;

const USAGE = 'usage: ci-audit.js gather [--days N] [--runs N] [--workflow <file>] [--repo owner/name | --root <dir>] [--min-sample N] [--thresholds <text>]\n'
  + '       ci-audit.js --help|-h\n';

// The phase definitions, verbatim from the plan's Global Constraints and checklist.md.
const DEFINITIONS = Object.freeze({
  waiting: 'job started − job created',
  setup: 'job started → start of the first step the workflow file declares as a command (steps with no declaration count as setup when they precede it)',
  running: 'that boundary → job completed',
});

// owner/name only, no `.`/`..` segment: the adapter interpolates both into request paths.
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const validSlug = (slug) => REPO_RE.test(slug) && slug.split('/').every((s) => s !== '.' && s !== '..');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function parseArgs(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { help: true };
  if (argv[0] !== 'gather') return { error: argv.length === 0 ? 'missing verb: gather' : `unknown verb: ${JSON.stringify(argv[0])}` };
  const o = { days: DEFAULT_DAYS, maxRuns: DEFAULT_MAX_RUNS, workflow: null, repo: null, root: null, minSample: null, thresholds: {} };
  const int = (v, lo, hi) => (v !== null && /^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (typeof v !== 'string' || v === '' || v.startsWith('--')) return null;
      i += 1;
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
      if (!validSlug(v)) return { error: `--repo ${JSON.stringify(v)} must be owner/name` };
      o.repo = v;
    } else if (a === '--root') {
      const v = next();
      if (v === null || !v.trim()) return { error: '--root requires a directory' };
      o.root = v;
    } else if (a === '--thresholds') {
      const v = next();
      const parsed = parseThresholds(v === null ? null : v);
      if (!parsed.ok) return { error: `--thresholds: ${parsed.error}` };
      o.thresholds = parsed.values;
    } else return { error: `unknown argument: ${JSON.stringify(a)}` };
  }
  if (o.repo !== null && o.root !== null) return { error: '--repo and --root each name the repository: pass one' };
  return o;
}

const realDeps = {
  runner: source.makeRunner(),
  readWorkflowFiles: (root) => source.readWorkflowFiles(root),
  // `root` is --root's value, or null for the checkout the CLI runs in.
  remoteUrl: (root) => originUrl(root || process.cwd()),
  pinHost: (repoSpec) => pinExplicitRepoHost(repoSpec),
  cwd: () => process.cwd(),
  now: null,
  clock: () => Date.now(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// -> { slug } or { error }. The host is pinned for the repository either way, so a --root
// checkout on another host than the current directory's still reaches its own.
function resolveRepo(o, deps) {
  let spec;
  if (o.repo !== null) {
    const [owner, repo] = o.repo.split('/');
    spec = { owner, repo };
  } else {
    const where = o.root === null ? '' : ` of ${JSON.stringify(o.root)}`;
    let url;
    try {
      url = deps.remoteUrl(o.root);
    } catch (err) {
      return { error: `no --repo and origin remote${where} unreadable: ${oneLine(errorText(err))}` };
    }
    const gated = gateOriginRepo(url, deps.gateDeps);
    if (gated.refusal) return { error: gated.refusal };
    if (!gated.spec) return { error: `no --repo and origin remote${where} names no forge repository — pass --repo <owner/name>` };
    spec = { host: gated.spec.host, owner: gated.spec.owner, repo: gated.spec.repo };
    if (!validSlug(`${spec.owner}/${spec.repo}`)) return { error: `origin remote resolves to an unusable owner/name — pass --repo <owner/name>` };
  }
  try {
    deps.pinHost(spec);
  } catch (err) {
    return { error: `could not pin the repository host: ${oneLine(errorText(err))}` };
  }
  return { slug: `${spec.owner}/${spec.repo}` };
}

// Facts per workflow file; a file that could not be read is an unparsed entry, never omitted.
function workflowFacts(listing) {
  const factsByWorkflow = {};
  const workflows = [];
  for (const w of listing.workflows) {
    const facts = typeof w.text === 'string'
      ? readWorkflowFacts(w.text)
      : { jobs: [], concurrencyDeclared: false, unparsed: [w.unreadable] };
    factsByWorkflow[w.file] = facts;
    workflows.push({ file: w.file, unparsed: facts.unparsed });
  }
  return { factsByWorkflow, workflows };
}

function noDataReason(o, read, agg) {
  if (read.runs.length > 0) {
    if (agg.jobs.length > 0) return null;
    return `the ${plural(read.runs.length, 'sampled run', 'sampled runs')} gave no job with phases: `
      + `${plural(agg.excluded, 'job', 'jobs')} excluded (a missing or out-of-order instant)`;
  }
  const u = read.unsampled;
  const why = [];
  if (u.skipped > 0) why.push(`${plural(u.skipped, 'run did', 'runs did')} no work (skipped)`);
  if (u.outsideWorkflows > 0) why.push(`${plural(u.outsideWorkflows, 'run came', 'runs came')} from outside the workflow-files directory`);
  if (u.noWorkflowPath > 0) why.push(`${plural(u.noWorkflowPath, 'run had', 'runs had')} no workflow path`);
  const filter = o.workflow === null ? '' : ` for workflow ${JSON.stringify(o.workflow)}`;
  return `no completed run was sampled in the ${o.days}-day window${filter}`
    + (why.length > 0 ? `: ${why.join('; ')}` : '')
    + (read.truncated.length > 0 ? ' — the window was truncated (see truncated)' : '');
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const fail = (message) => { deps.stderr(`ci-audit.js: ${message}\n`); return 2; };
  if (o.error) return fail(`${o.error} (see --help)`);
  if (o.help) { deps.stdout(USAGE); return 0; }

  const resolved = resolveRepo(o, deps);
  if (resolved.error) return fail(resolved.error);

  const now = deps.now || new Date();
  const read = source.readRunData({
    runner: deps.runner, repo: resolved.slug, days: o.days, maxRuns: o.maxRuns, workflow: o.workflow, now, clock: deps.clock || null,
  });
  const failures = [...read.failures];
  const listing = deps.readWorkflowFiles(o.root || deps.cwd());
  if (!listing.ok) failures.push(`workflow files: ${listing.error}`);
  const { factsByWorkflow, workflows } = workflowFacts(listing);

  const agg = aggregate(read.runs, factsByWorkflow);
  const unjudged = new Set(workflows.filter((w) => w.unparsed.length > 0).map((w) => w.file));
  const breaches = evaluate(agg, factsByWorkflow, o.thresholds, o.minSample)
    .filter((b) => b.workflow === null || !unjudged.has(b.workflow));
  const reason = read.ok ? noDataReason(o, read, agg) : null;

  const report = {
    definitions: DEFINITIONS,
    window: {
      days: o.days,
      from: new Date(now.getTime() - o.days * DAY_MS).toISOString().slice(0, 10),
      maxRuns: o.maxRuns,
      workflow: o.workflow,
      sampledRuns: read.runs.length,
    },
    workflows,
    jobs: agg.jobs,
    criticalPaths: agg.criticalPaths,
    shardSkews: agg.shardSkews,
    repeatedSteps: agg.repeatedSteps,
    overlaps: agg.overlaps,
    breaches,
    excluded: agg.excluded,
    truncated: read.truncated,
    failures,
    unsampled: read.unsampled,
    noData: reason === null ? null : { reason },
  };
  deps.stdout(`${JSON.stringify(report)}\n`);
  if (read.cliAbsent) return 3;
  return read.ok ? 0 : 2;
}

module.exports = { run, parseArgs, realDeps, USAGE, DEFINITIONS };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
