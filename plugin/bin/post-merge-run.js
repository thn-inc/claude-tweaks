#!/usr/bin/env node
// bin/post-merge-run.js -- run the reconciler's guarded post-merge closes for ONE
// named run dir (#4692). lib/reconcile/post-merge.js's `postMerge` walks the live
// run dirs of a pass; `postMergeOne` is the same guarded path (marker check, merged
// check, claim, Step 4.0 then 4.0b, marker last) for one dir the caller names --
// an `archive/{run-id}` dir included. wrap-up/merge-mode.md's Already merged
// section calls this when `gh pr merge` finds the PR already MERGED by something
// else (an armed auto-merge, a merge queue, a human); the marker and the claim
// keep it and the reconciler from running the steps twice.
//
//   node bin/post-merge-run.js --run <run-dir> [--help]
//
// Prints exactly one JSON line, `postMergeOne`'s entry:
//   {runDir, pr, action: ran | skipped, reason?, detail?, closingLinks?,
//    parentsClosed?, attempt?, step40Failed?, records?}
// ran: Steps 4.0 and 4.0b ran and the marker is written; `closingLinks` is Step
//   4.0's action, and `step40Failed` and `records` ({failed, closeFailed,
//   pendingClose, unchecked}, issue numbers) appear when Step 4.0 did not finish
//   cleanly. already-done: a marker is already in the run's decisions.md.
//   in-flight: another process holds the run's claim. Any other reason (no-pr,
//   not-merged, claim-failed, transient-failure, network-failure,
//   marker-write-failed, error, not-github-issues, no-remote, no-pr-states, and
//   this CLI's own gh-absent -- `pr: null`, no lookup made) is a failure to report.
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
const { postMergeOne } = require('./lib/reconcile/post-merge');
const { resolvePrStateByNumberAsync } = require('./lib/reconcile/pr-state');
const { mainCheckoutRoot } = require('./lib/hooks/worktree-detect');

const USAGE = 'usage: post-merge-run.js --run <run-dir> [--help]\n'
  + '  runs the post-merge closes (Step 4.0 closing-links, Step 4.0b below-floor parent close) once for the one named run dir, archived included\n'
  + '  prints one JSON line {runDir, pr, action, reason?, closingLinks?, parentsClosed?, step40Failed?, records?}; action:\n'
  + '    ran: the steps ran and the marker is written (step40Failed and records {failed, closeFailed, pendingClose, unchecked} when Step 4.0 did not finish cleanly)\n'
  + '    skipped: reason already-done (a marker is present) | in-flight (another process holds the claim); any other reason is a failure to report\n'
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
  if (!hasGh) return print({ runDir, pr: null, action: 'skipped', reason: 'gh-absent' });

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
    return print({
      runDir, pr: null, action: 'skipped', reason: 'error', detail: String((e && e.message) || e).slice(0, 300),
    });
  }
}

module.exports = { run, parseArgs };

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
