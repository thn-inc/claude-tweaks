#!/usr/bin/env node
// bin/post-merge-run.js -- run the reconciler's guarded post-merge closes for ONE
// named run dir (#4692). lib/reconcile/post-merge.js's `postMerge` walks the live
// run dirs of a pass; `postMergeOne` is the same guarded path (marker check, merged
// check, claim, Step 4.0 then 4.0b, marker last) for one dir the caller names --
// an `archive/{run-id}` dir included. wrap-up/merge-mode.md's Already merged
// section calls this when its Preconditions'
// `gh pr view --json state` finds the PR MERGED (an armed auto-merge, a merge
// queue, a human merged it); the marker and the claim keep it and the
// reconciler from running the steps twice.
//
//   node bin/post-merge-run.js --run <run-dir> [--help]
//
// Prints exactly one JSON line, `postMergeOne`'s entry:
//   {runDir, pr, action: ran | skipped, reason?, detail?, closingLinks?,
//    parentsClosed?, attempt?, step40Failed?, records?, logFailed?, parentFailures?,
//    verdict, next}
// ran: Steps 4.0 and 4.0b ran and the marker is written; `closingLinks` is Step
//   4.0's action. `step40Failed` marks a Step 4.0 that itself failed. `records`
//   ({failed, closeFailed, pendingClose, unchecked}, issue numbers) is on every
//   `ran` entry Step 4.0 printed a readable envelope for, so it is absent only
//   when `step40Failed` comes from a non-zero exit or unparseable output;
//   `logFailed: true` when Step 4.0 could not append a decisions.md line.
//   `parentFailures` ([{parent | issue, reason, detail?}]) is on every `ran`
//   entry Step 4.0b ran for: every skip that is not a deliberate gate outcome
//   (`gh-failed`, `internal-error`, the step-wide `unreadable-policy` /
//   `invalid-risk-floor` with no parent key, or any unlisted reason); a
//   non-empty one is a failure to report.
//   already-done: a marker is already in the run's decisions.md.
//   in-flight: another process holds the run's claim. Any other reason (no-pr,
//   not-merged, claim-failed, transient-failure, network-failure,
//   marker-write-failed, error, not-github-issues, no-remote, no-pr-states,
//   merged-at-unreadable (a MERGED PR whose mergedAt does not parse: its age is
//   unknown, so nothing runs),
//   no-pr-state, pr-not-found, invalid-arguments -- the last three are the PR-state
//   resolver's own answer passed through -- and this CLI's own gh-absent -- `pr: null`,
//   no lookup made) is a failure to report.
// Every entry, this CLI's own included, closes with two routing fields that
// post-merge.js's classifyEntry derives (the caller routes on them, never on the
// words above): `verdict` clean (a `ran` entry with a clean Step 4.0 word, no
// step40Failed and no parentFailures element) | failed | already-done | in-flight,
// and `next` rerun (a marker-less skip a re-run retries; post-merge.js's
// RERUN_REASONS) | rerun-where-gh (gh-absent) | rerun-after-stale-claim (an archived run's in-flight) | none
// (every other entry, each `ran` failure included: its marker is written).
//
// Status is data: exit 0 whenever an entry was printed, whatever its action or reason.
// 2 malformed invocation (unknown flag, missing --run, --run without a value).
// 3 run dir missing or not anchored under the main checkout (a worktree-local
//   shadow -- _shared/pipeline-run-dir.md, [IL-127]); an archive/{run-id} dir in
//   the main checkout is anchored. Same vocabulary as closing-links.js.
'use strict';

const path = require('path');
const { resolveTarget } = require('./lib/log-decision/append');
const { ghAvailable } = require('./lib/repo-resolve');
const { postMergeOne, classifyEntry, boundDetail } = require('./lib/reconcile/post-merge');
const { resolvePrStateByNumberAsync } = require('./lib/reconcile/pr-state');
const { mainCheckoutRoot } = require('./lib/hooks/worktree-detect');

const USAGE = 'usage: post-merge-run.js --run <run-dir> [--help]\n'
  + '  runs the post-merge closes (Step 4.0 closing-links, Step 4.0b below-floor parent close) once for the one named run dir, archived included\n'
  + '  prints one JSON line {runDir, pr, action, reason?, closingLinks?, parentsClosed?, step40Failed?, records?, logFailed?, parentFailures?, verdict, next}; action:\n'
  + '    ran: the steps ran and the marker is written (step40Failed when Step 4.0 itself failed; records {failed, closeFailed, pendingClose, unchecked} whenever Step 4.0 printed a readable envelope;\n'
  + '         logFailed when Step 4.0 could not append a decisions.md line; parentFailures [{parent|issue, reason, detail?}] when Step 4.0b ran, non-empty = a failed close)\n'
  + '    skipped: reason already-done (a marker is present) | in-flight (another process holds the claim); any other reason is a failure to report\n'
  + '  route on verdict (clean | failed | already-done | in-flight) and next (rerun | rerun-where-gh | rerun-after-stale-claim | none), never on the words above\n'
  + '  exit 0 an entry was printed (every action and reason is data)\n'
  + '       2 malformed invocation\n'
  + '       3 run dir missing or not anchored under the main checkout\n';

function parseArgs(argv) {
  const o = { run: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a !== '--run') return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} needs a value` };
    o.run = v;
    i++;
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  ghAvailable: () => ghAvailable(),
  prStates: null,
  now: () => Date.now(),
  postMergeDeps: {},
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

async function run(argv, overrides = {}) {
  // Tests pass only the seams they fake; the rest stay real.
  const deps = { ...realDeps, ...overrides };
  const usageError = (message) => { deps.stderr(`post-merge-run.js: ${message}\n${USAGE}`); return 2; };
  const print = (body) => { deps.stdout(`${JSON.stringify(body)}\n`); return 0; };
  // The CLI's own entries carry postMergeOne's routing fields too, classified by the same code.
  const printOwn = (body) => print({ ...body, ...classifyEntry(body) });

  // 1. Parse / validate. --help answers before any probe.
  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');

  // 2. The run dir must be the main checkout's (or its archive/), never a worktree-local shadow.
  let cwd;
  let target;
  try {
    cwd = deps.cwd();
    target = resolveTarget({ runDir: o.run, cwd, mainRoot: deps.mainRoot });
  } catch (e) {
    deps.stderr(`post-merge-run.js: could not resolve the run dir ${o.run}: ${(e && e.message) || e}\n`);
    return 3;
  }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`post-merge-run.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`post-merge-run.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }
  // The validated real path: what postMergeOne reads, claims and logs under.
  const runDir = path.dirname(target.file);

  // 3. No gh: status as data, never a failure, and no lookup.
  let hasGh = false;
  try { hasGh = !!deps.ghAvailable(); } catch { hasGh = false; }
  if (!hasGh) return printOwn({ runDir, pr: null, action: 'skipped', reason: 'gh-absent' });

  // 4. One guarded pass over the one dir.
  try {
    const root = (typeof deps.mainRoot === 'string' && deps.mainRoot) || mainCheckoutRoot(cwd) || cwd;
    const entry = await postMergeOne({
      runDir,
      cwd,
      prStates: deps.prStates || { byNumberAsync: (n) => resolvePrStateByNumberAsync(root, n) },
      now: deps.now,
      deps: deps.postMergeDeps,
    });
    return print(entry);
  } catch (e) {
    return printOwn({
      runDir, pr: null, action: 'skipped', reason: 'error', detail: boundDetail(String((e && e.message) || e)),
    });
  }
}

module.exports = { run, parseArgs };

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
