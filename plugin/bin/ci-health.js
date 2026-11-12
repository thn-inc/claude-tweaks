#!/usr/bin/env node
// bin/ci-health.js — /claude-tweaks:harness-health's CI health check (#5161): per-workflow run
// duration, trend, superseded and cancelled runs and push-run coverage over a window of GitHub
// Actions runs, plus Actions budget headroom; files one deduplicated issue on a threshold breach,
// and only under --file. Reporting only: it never edits a workflow or the merge gate's watch.
// Logic lives in run(argv, deps); every side effect (runner, remoteUrl, pinGhHost, workTypes,
// openIssueTitles, createIssue, now, stdout, stderr) is injected so tests never touch gh.
//
// Usage: ci-health.js [--days N] [--repo owner/name] [--min-headroom-pct N] [--file] [--json] [--help|-h]
//   --days N               window length, an integer 1..400 (default 30); the window starts at the
//                          UTC date N days before now
//   --repo owner/name      a github.com repository (default: the origin remote, which must be on
//                          github.com); its host is pinned for every gh call
//   --min-headroom-pct N   the headroom floor, a number 0..100 (default 10)
//   --file                 file the breach issue (exact-title dedup against open by:harness-health
//                          issues; never on a truncated window or a failed runs read, page 1
//                          included: `not filed: runs read failed`)
//   --json                 print the report envelope as one JSON line instead of the report lines;
//                          its `filed` is {title, number} or null, `filingSkipped` the skip reason
//                          or null (both null without --file), and a failed filing a failures[]
//                          entry (`file issue` or `open issue titles`)
// Exit codes:
//   0 report written — partial allowed: a runs half that read at least one page, whatever billing
//     returns; a failed filing is named in failures[]
//   2 malformed invocation, an unresolvable or non-github.com origin, or every runs read failed
//     (the runs half read no page, gh absent included), whatever billing returns. On that
//     read-failure exit 2 the full report still goes to stdout (billing line included), so nothing
//     read is lost; a usage or origin error writes one line to stderr and nothing to stdout.
// Overload decision: the harness-health sub-file tells a read failure from a usage error by whether
// stdout carries report lines, so no third code is earned. Reopen when a caller must branch on the
// code itself.
//
// Every gh call is bounded by CI_HEALTH_GH_TIMEOUT_MS (15 s; constants.js states why it does not
// follow `gh-timeout-ms`) and runs with stdio piped, since every failure is caught and reported.
// The workflow-runs and billing reads have no GitHub MCP equivalent, so a gh-absent sandbox gets no
// fallback read: the report says both halves are unavailable.
'use strict';

const { execFileSync } = require('child_process');
const { remoteUrl, originSpecOf, repoSlug, ghOptions, pinExplicitRepoHost } = require('./lib/repo-resolve');
const { readWorkTypes } = require('./lib/work-backend');
const { LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
const {
  CI_HEALTH_GH_TIMEOUT_MS, MERGE_GATE_WATCH_SECONDS, DEFAULT_DAYS, MAX_DAYS, DEFAULT_MIN_HEADROOM_PCT,
} = require('./lib/ci-health/constants');
const { computeStats } = require('./lib/ci-health/stats');
const { readRepo, fetchRuns, errorText } = require('./lib/ci-health/fetch');
const { readBilling } = require('./lib/ci-health/billing');
const { breachesOf, fileBreaches } = require('./lib/ci-health/thresholds');
const { renderReport, oneLine } = require('./lib/ci-health/render');

const USAGE = 'usage: ci-health.js [--days N] [--repo owner/name] [--min-headroom-pct N] [--file] [--json] [--help|-h]\n';

// owner/name only: no host prefix, no leading hyphen on the owner, no third segment. Both values
// are interpolated into REST paths, so `.`/`..` segments are refused too (gh-api-module-pattern).
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function validSlug(slug) {
  return REPO_RE.test(slug) && slug.split('/').every((segment) => segment !== '.' && segment !== '..');
}

function parseArgs(argv) {
  const o = { days: DEFAULT_DAYS, repo: null, minHeadroomPct: DEFAULT_MIN_HEADROOM_PCT, file: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (typeof v !== 'string' || v === '' || v.startsWith('--')) return null;
      i += 1;
      return v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--file') o.file = true;
    else if (a === '--json') o.json = true;
    else if (a === '--days') {
      const v = next();
      if (v === null || !/^\d+$/.test(v) || Number(v) < 1 || Number(v) > MAX_DAYS) return { error: `--days takes an integer from 1 to ${MAX_DAYS}` };
      o.days = Number(v);
    } else if (a === '--min-headroom-pct') {
      const v = next();
      if (v === null || !/^\d+(\.\d+)?$/.test(v) || Number(v) > 100) return { error: '--min-headroom-pct takes a number from 0 to 100' };
      o.minHeadroomPct = Number(v);
    } else if (a === '--repo') {
      const v = next();
      if (v === null) return { error: '--repo requires a value' };
      if (!validSlug(v)) return { error: `--repo ${JSON.stringify(v)} must be owner/name on github.com` };
      o.repo = v;
    } else return { error: `unknown argument: ${JSON.stringify(a)}` };
  }
  return o;
}

// A 100-run `actions/runs` page is several MiB of JSON, past execFileSync's 1 MiB default buffer
// (ENOBUFS on the first real read), so the seam takes the shared large buffer.
const ghRunner = (args, opts = {}) => execFileSync('gh', args, ghOptions(args, {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: CI_HEALTH_GH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, input: opts.input, windowsHide: true,
}));

function issueListArgs(slug) {
  return ['issue', 'list', '--repo', slug, '--label', 'by:harness-health', '--state', 'open', '--json', 'title', '--limit', '500'];
}

// One --label per entry, so the labels branch's `type:task` rides along; --type only on the native
// branch (harness-health/filing.md's two example calls).
function issueCreateArgs(slug, { title, labels, type }) {
  return [
    'issue', 'create', '--repo', slug, '--title', title, '--body-file', '-',
    ...labels.flatMap((label) => ['--label', label]), ...(type ? ['--type', type] : []),
  ];
}

// The filing deps over a runner; thresholds.js's fileBreaches catches their throws.
function issueDeps(runner) {
  return {
    openIssueTitles: (slug) => {
      const list = JSON.parse(runner(issueListArgs(slug)));
      return Array.isArray(list) ? list.map((issue) => issue && issue.title) : null;
    },
    createIssue: (slug, issue) => {
      const m = /\/issues\/(\d+)/.exec(String(runner(issueCreateArgs(slug, issue), { input: issue.body })));
      return { number: m ? Number(m[1]) : null };
    },
  };
}

const realDeps = {
  runner: ghRunner,
  ...issueDeps(ghRunner),
  remoteUrl: () => remoteUrl(),
  pinGhHost: (repoSpec) => pinExplicitRepoHost(repoSpec),
  // The checkout the CLI runs in, as reflect-apply.js reads it; readWorkTypes never throws.
  workTypes: () => readWorkTypes(process.cwd()),
  now: null,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// A remote URL's `userinfo@` (everything between `://` and the last `@` before the host) can be a
// token, so a remote echoed into a message drops it.
function withoutUserinfo(url) {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/]*@/i, '$1');
}

function resolveSlug(o, deps) {
  if (o.repo) {
    try {
      deps.pinGhHost({ host: 'github.com' });
    } catch (err) {
      return { error: `could not pin the github.com host for --repo: ${oneLine(errorText(err))}` };
    }
    return { slug: o.repo };
  }
  let url;
  try {
    url = deps.remoteUrl();
  } catch (err) {
    return { error: `no --repo and origin remote unreadable: ${oneLine(errorText(err))}` };
  }
  const spec = originSpecOf(url);
  if (!spec) return { error: `no --repo and origin remote is not a GitHub URL: ${withoutUserinfo(oneLine(url))}` };
  if (spec.host !== 'github.com') {
    return { error: `origin remote is on ${spec.host}, not github.com — pass --repo <owner/name> for a github.com repository` };
  }
  const slug = repoSlug({ owner: spec.owner, repo: spec.repo });
  if (!validSlug(slug)) return { error: `origin remote resolves to an unusable owner/name ${JSON.stringify(slug)} — pass --repo <owner/name>` };
  return { slug };
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const fail = (message) => { deps.stderr(`ci-health.js: ${message}\n`); return 2; };
  if (o.error) return fail(`${o.error} (see --help)`);
  if (o.help) { deps.stdout(USAGE); return 0; }

  const resolved = resolveSlug(o, deps);
  if (resolved.error) return fail(resolved.error);
  const { slug } = resolved;
  const [owner, repo] = slug.split('/');

  const now = deps.now || new Date();
  const from = new Date(now.getTime() - o.days * DAY_MS).toISOString().slice(0, 10);
  const { runner } = deps;
  const repoRead = readRepo({ owner, repo }, { runner });
  const runs = fetchRuns({ owner, repo, from }, { runner });
  const { billing, failures: billingFailures } = readBilling({ repoRead }, { runner });

  // gh absence renders from `ghAbsent`, so it adds no failure row.
  const failures = [];
  if (!repoRead.ok && !repoRead.ghAbsent) failures.push({ query: 'repo', status: repoRead.status, error: repoRead.error });
  failures.push(...runs.failures, ...billingFailures);

  const workflows = computeStats(runs.runs, {
    from: new Date(`${from}T00:00:00Z`),
    days: o.days,
    defaultBranch: repoRead.ok ? repoRead.defaultBranch : null,
  });
  const breaches = breachesOf({ workflows, billing }, { minHeadroomPct: o.minHeadroomPct, watchSeconds: MERGE_GATE_WATCH_SECONDS });

  let filed = null;
  let filingSkipped = null;
  if (o.file) {
    const outcome = fileBreaches(
      { breaches, truncated: runs.truncated, partial: runs.failures.length > 0, file: true },
      { openIssueTitles: () => deps.openIssueTitles(slug), createIssue: (issue) => deps.createIssue(slug, issue) },
      { repo: slug, days: o.days, watchSeconds: MERGE_GATE_WATCH_SECONDS, minHeadroomPct: o.minHeadroomPct, workTypes: deps.workTypes() },
    );
    ({ filed, skipped: filingSkipped } = outcome);
    if (outcome.failure) failures.push(outcome.failure);
  }

  const report = {
    repo: slug,
    window: { days: o.days, from },
    truncated: runs.truncated,
    ghAbsent: runs.ghAbsent,
    workflows,
    watchSeconds: MERGE_GATE_WATCH_SECONDS,
    minHeadroomPct: o.minHeadroomPct,
    billing,
    failures,
    breaches,
    filed,
    filingSkipped,
  };
  deps.stdout(o.json ? `${JSON.stringify(report)}\n` : `${renderReport(report).join('\n')}\n`);
  return runs.pages === 0 ? 2 : 0;
}

module.exports = { run, parseArgs, realDeps, USAGE, issueListArgs, issueCreateArgs, issueDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
