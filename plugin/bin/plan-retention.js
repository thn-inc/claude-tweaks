#!/usr/bin/env node
// bin/plan-retention.js — which plans delete, keep, prune-ask or prune-archive,
// and whether the citation check and the decline lookup are needed. The one
// implementation `tidy/scan-procedures.md` Step 4's Plan retention cites instead
// of restating the arithmetic in prose (#4594): a first-add date per plan from
// git, then lib/plan-retention/route.js's routePlans over them.
//
// Usage: plan-retention.js --retention <keep-forever|prune-after-wrapup|ask>
//        [--cited <plan>]... [<plan>...] [--help]
//   --retention  the project's plan-retention policy value.
//   <plan>       a repo-relative path under docs/superpowers/plans/.
//   --cited      a plan named by a citation check, repeatable; each must also be
//                given as a <plan>, and only under keep-forever. This is the
//                two-pass shape: a first run without --cited reports
//                `citationCheck: true` and the `citationCandidates` to check;
//                the caller re-runs with the plans the check found cited, and
//                that run's routes are final (`citationCheck` is then false).
//                A check that finds none cited needs no second run — the first
//                run's routes already assume none are.
// Output: one JSON line on stdout, keys in this order: retention, today,
// cutoffDays, threshold, citationCheck, citationCandidates, decline, plans —
// `plans` carries `{plan, firstAdded, pastCutoff, cited, route}` per plan.
// `citationCheck` is true when the caller owes the citation check, and
// `citationCandidates` names the plans to check. Under keep-forever that is the
// first pass only (its routes are provisional until the --cited re-run); under
// ask and prune-after-wrapup it is true whenever any plan is a candidate, and
// the routes are final (the check's outcome applies directly). `decline` is null
// unless the decline lookup ran (keep-forever, 30 or more uncited past-cutoff
// plans); then it is `{live, error}`.
// Exit codes (the residue.js vocabulary): 0 for any successful render,
// including a degraded one — a git probe that fails reads as `uncommitted` and
// keeps (and names the count in one stderr line, since the JSON cannot tell it
// from a plan that is truly uncommitted), a decline lookup that throws is
// `decline.error` and keeps every plan, never a non-zero exit; 2 only for a
// malformed invocation (usage on stderr, nothing on stdout). `--help` prints
// usage and exits 0 before anything else is read.
//
// Run it from {REPO_ROOT}: the git first-add probe uses the process cwd, and so
// does the declined-learning store (`.claude-tweaks/declined-learning/`), which
// the decline lookup reads in-process rather than through `declined-learning.js`
// (one process instead of a spawn per run; the fingerprint is pinned equal to
// the verb's by tests/bin-lib/plan-retention/cli.test.js).
'use strict';

const { execFileSync } = require('node:child_process');
const { RETENTION_VALUES, CUTOFF_DAYS, ARCHIVE_THRESHOLD, routePlans } = require('./lib/plan-retention/route');
const { archiveDeclineFingerprint, firstAddedDate } = require('./lib/plan-retention/probe');
const store = require('./lib/declined-learning/store');

const PLANS_PREFIX = 'docs/superpowers/plans/';

const USAGE = 'usage: plan-retention.js --retention <keep-forever|prune-after-wrapup|ask> [--cited <plan>]... [<plan>...] [--help]\n'
  + '  plans are repo-relative paths under docs/superpowers/plans/; --cited only with keep-forever, each cited plan also given as a plan\n'
  + '  run from the repo root; prints one JSON line; exit 0 on any render, 2 on a malformed invocation\n';

// A value-taking flag given last, empty, or followed by another flag reads as a
// missing value, never as a retention or a plan.
function parseArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  const o = { retention: null, plans: [], cited: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--retention' || a === '--cited') {
      const v = argv[++i];
      if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} requires a value` };
      if (a === '--retention') {
        if (o.retention !== null) return { error: '--retention given twice' };
        o.retention = v;
      } else {
        o.cited.push(v);
      }
    } else if (a.startsWith('--')) {
      return { error: `unknown argument: ${a}` };
    } else {
      if (!a.startsWith(PLANS_PREFIX)) return { error: `plan is not under ${PLANS_PREFIX}: ${a}` };
      if (a.split(/[\\/]/).includes('..')) return { error: `plan has a .. segment: ${a}` };
      if (a.endsWith('/')) return { error: `plan has no file name: ${a}` };
      if (o.plans.includes(a)) return { error: `plan given twice: ${a}` };
      o.plans.push(a);
    }
  }
  if (o.retention === null) return { error: '--retention is required' };
  if (!RETENTION_VALUES.includes(o.retention)) return { error: `unknown retention value: ${o.retention}` };
  if (o.cited.length > 0 && o.retention !== 'keep-forever') return { error: '--cited applies only to --retention keep-forever' };
  const stray = o.cited.find((plan) => !o.plans.includes(plan));
  if (stray !== undefined) return { error: `--cited plan is not among the plans: ${stray}` };
  return o;
}

// Today's calendar date in the process's timezone. A plan's first-add date is
// git's `%cs`, the committer date in that commit's own timezone, so the two
// can differ by a day across timezones: a plan exactly on the 7-day line may
// read one day younger or older. Accepted — the effect is one day on one plan,
// and routes only ever feed an approval-gated proposal.
function localDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const realDeps = {
  git: (args) => {
    try {
      return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
    } catch {
      return null;
    }
  },
  lookupDecline: (fingerprint) => store.lookupDecline(fingerprint),
  today: localDate,
  stdout: process.stdout,
  stderr: process.stderr,
};

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.help) { deps.stdout.write(USAGE); return 0; }
  if (opts.error) { deps.stderr.write(`plan-retention.js: ${opts.error}\n${USAGE}`); return 2; }

  const today = deps.today();
  // A failed git run (null, or a throw) and a plan git has no add commit for both read as
  // `uncommitted`; count the failures so a broken probe (git missing, wrong cwd) is not silent.
  let probeFailures = 0;
  const git = (args) => {
    let out;
    try { out = deps.git(args); } catch (err) { probeFailures += 1; throw err; }
    if (out === null) probeFailures += 1;
    return out;
  };
  const plans = opts.plans.map((plan) => ({ plan, firstAdded: firstAddedDate(plan, git) }));
  if (probeFailures > 0) {
    deps.stderr.write(`plan-retention.js: git failed for ${probeFailures} of ${plans.length} plan(s); read as uncommitted and kept\n`);
  }
  const routed = routePlans({
    retention: opts.retention,
    plans,
    today,
    cited: opts.cited.length > 0 ? new Set(opts.cited) : null,
    lookupDecline: () => deps.lookupDecline(archiveDeclineFingerprint()),
  });
  deps.stdout.write(`${JSON.stringify({
    retention: opts.retention,
    today,
    cutoffDays: CUTOFF_DAYS,
    threshold: ARCHIVE_THRESHOLD,
    citationCheck: routed.citationCheck,
    citationCandidates: routed.citationCandidates,
    decline: routed.decline,
    plans: routed.plans,
  })}\n`);
  return 0;
}

module.exports = { run, parseArgs, realDeps, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
