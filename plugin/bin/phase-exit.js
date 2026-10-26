#!/usr/bin/env node
// bin/phase-exit.js -- one pipeline phase exit in one call (#4026): route,
// branch guard, commit check, bookkeeping backfill, push, PR checklist flip and
// post-push merge-state read. The sub-steps and the guard each keeps are
// lib/phase-exit/phase-exit.js's; the procedures it runs are
// skills/_shared/git-discipline.md's Phase exit and Post-push merge-state
// check, build/SKILL.md Common Step 7's Bookkeeping assertion and
// skills/_shared/pr-checklist-refresh.md's Phase-checklist update.
//
//   node bin/phase-exit.js --run <run-dir> --phase <build|test|review|polish|wrap-up>
//     --worktree <path> [--fixes <n>[,<m>...]] [--remove] [--summary-file <file>] [--help]
//
// --fixes, --remove and --summary-file are forwarded to bin/pr-checklist.js
// unchanged (validated by its parseArgs first). At wrap-up's exit pass --run the
// archive path once cleanup archived the run dir.
//
// Prints one JSON line: {phase, route, branch, head, commit: {clean, dirty} | null,
// bookkeeping: {worktree, pr, detail?} | null, push: {state, reason?},
// checklist: {exit, ...pr-checklist envelope} | null,
// mergeState: {exit, ...pr-merge-state envelope} | null,
// logFailures: [{kind: 'decision', status, step, text, error} | {kind: 'event', type, data, error}]}.
//   route        pr-first | local-merge | current-branch | null (integration-model unresolved)
//   push.state   pushed | failed | refused (not a run branch, or --worktree is not the active
//                run's worktree: a wd-push-mismatch event) | skipped (also: pr-first with no
//                recorded PR and no release condition of hooks/pre-tool-use.js's PR-stamp gate, [IL-131])
//   worktree     present | backfilled | failed | n/a (current-branch, closed run)
//   pr           present | backfilled | missing | failed | n/a (local-merge, current-branch, prExempt, closed run)
// The push runs under GIT_PUSH_TIMEOUT_MS (lib/shared-primitives.js: 10 minutes, or
// CLAUDE_TWEAKS_GIT_PUSH_TIMEOUT_MS, 1000-3600000); a kill is reason `timed out after {n} ms`.
// The CLI writes its own decisions.md lines under the phase's section; the
// sub-CLIs write theirs. A caller hand-logs only a logFailures entry.
//
// Status is data: exit 0 in every route and state.
// 2 malformed invocation, or --worktree is not a git checkout.
// 3 run dir missing or not anchored under the main checkout (a worktree-local
//   shadow -- _shared/pipeline-run-dir.md, [IL-127]).
'use strict';

const path = require('path');
const { resolveTarget } = require('./lib/log-decision/append');
const { runPhaseExit, realDeps, checklistFlags, InvalidWorktreeError, PHASE_SECTIONS } = require('./lib/phase-exit/phase-exit');
const prChecklist = require('./pr-checklist');

const PHASES = Object.keys(PHASE_SECTIONS).join('|');

const USAGE = `usage: phase-exit.js --run <run-dir> --phase <${PHASES}> --worktree <path>\n`
  + '         [--fixes <n>[,<m>...]] [--remove] [--summary-file <file>] [--help]\n'
  + '  one phase exit: route, branch guard, commit check, bookkeeping backfill, push,\n'
  + '  PR checklist flip (pr-checklist.js), merge-state read after a push (pr-merge-state.js)\n'
  + '  prints {phase, route, branch, head, commit, bookkeeping, push, checklist, mergeState, logFailures}\n'
  + '  route: pr-first | local-merge | current-branch | null; push.state: pushed | failed | refused | skipped\n'
  + '  refused: not a run branch, or --worktree is not the active run\'s worktree (wd-push-mismatch event)\n'
  + '  a closed run (close-run, archived or not) gets no bookkeeping write and no events.jsonl line\n'
  + '  the push may run 10 minutes (CLAUDE_TWEAKS_GIT_PUSH_TIMEOUT_MS overrides, 1000-3600000)\n'
  + '  --fixes, --remove, --summary-file are forwarded to pr-checklist.js unchanged\n'
  + '  exit 0 in every route and state; 2 malformed invocation or --worktree not a git checkout;\n'
  + '       3 run dir missing or not anchored\n';

const VALUE_FLAGS = { '--run': 'run', '--phase': 'phase', '--worktree': 'worktree', '--fixes': 'fixes', '--summary-file': 'summaryFile' };

function parseArgs(argv) {
  const o = { run: null, phase: null, worktree: null, fixes: null, summaryFile: null, remove: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--remove') { o.remove = true; continue; }
    if (!Object.hasOwn(VALUE_FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
    o[VALUE_FLAGS[a]] = v;
    i++;
  }
  return o;
}

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const usageError = (message) => { deps.stderr(`phase-exit.js: ${message}\n${USAGE}`); return 2; };

  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');
  if (!o.phase) return usageError(`--phase <${PHASES}> is required`);
  if (!Object.hasOwn(PHASE_SECTIONS, o.phase)) return usageError(`invalid --phase: ${o.phase}`);
  if (!o.worktree) return usageError('--worktree <path> is required');
  // The forwarded flags must be ones pr-checklist.js accepts -- checked by its own parser.
  const fwd = prChecklist.parseArgs(checklistFlags(o));
  if (fwd.error) return usageError(fwd.error);

  const target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot });
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`phase-exit.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`phase-exit.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }

  // Absolute from here on: the sub-steps spawn with cwd --worktree, so a relative
  // path would name a different directory in different sub-steps.
  let envelope;
  try {
    envelope = runPhaseExit({
      run: path.resolve(o.run), phase: o.phase, worktree: path.resolve(o.worktree),
      fixes: o.fixes, remove: o.remove, summaryFile: o.summaryFile,
    }, deps);
  } catch (e) {
    if (e instanceof InvalidWorktreeError) return usageError(e.message);
    throw e;
  }
  deps.stdout(`${JSON.stringify(envelope)}\n`);
  return 0;
}

module.exports = { run, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
