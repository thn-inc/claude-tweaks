#!/usr/bin/env node
// bin/learned-skills-pr.js — keeps wrap-up's Skills-row edits off the run branch (#5290).
//
//   node bin/learned-skills-pr.js capture --run <run-dir> --worktree <abs> --merge-base <sha>
//     --target <repo-rel> --summary-file <path> [--row <row-id>] [--help]
//
// `capture` moves one working-tree edit of a skill file into {run-dir}/learned-skills/{id}.patch and
// reverts it in the worktree. --row is the finding's wrap-up registry row id (default skills); the
// manifest entry records every finding's {row, summary}, so `land` logs one AUTO line per finding.
// Stdout is one JSON line:
//   {route:'run-branch', reason:'record-owned'}   the record's own commits already touched the file —
//                                                 the edit stays on the run branch (caller commits it)
//   {route:'captured', id, patch, shared[, manifestFailed]}
//                                                 patch written, tree reverted; shared:true when the
//                                                 target was already captured in this run;
//                                                 manifestFailed:true — a shared finding could not be
//                                                 added to the manifest, so land logs no AUTO line for
//                                                 it and the caller hand-logs one
//   {route:'clean'}                               nothing changed and nothing captured before
//   {route:'staged', stagePath, reason[, patch][, residue][, logFailed]}
//                                                 a failure after the diff was read: the edit is
//                                                 staged as staged/wrap-up-skill-{N}.md instead (in a
//                                                 join, this edit alone; the earlier capture stays).
//                                                 patch — when the staged file is description-only
//                                                 or unvalidated, the patch file that holds the edit;
//                                                 residue:true — git status still lists the target
//                                                 (an index entry could not be cleared);
//                                                 logFailed:true — the STAGED line did not land in
//                                                 decisions.md, the caller hand-logs it
//
//   node bin/learned-skills-pr.js land --run <run-dir> --worktree <abs> --record <n> [--record <m> …]
//     --integration-branch <name> --merge-base <sha>
//   node bin/learned-skills-pr.js stage --run <run-dir> --worktree <abs> --reason <text> --merge-base <sha>
//
// `land` commits each captured patch (plumbing, on a temp index) to learned-skills/{run-id}, pushes it and
// opens a ready PR that is never armed; a patch that cannot ride it is staged instead. `stage` stages
// every captured patch (local-merge). --merge-base (required) marks a captured entry whose edit the
// run branch already carries (its patch reverse-applies to HEAD) as superseded, never delivered twice.
// Stdout is one JSON line (pr is set only when confirmed open in this call):
//   land:  {branch, pr: {number,url}|null, landed: [{id,target,commit}], staged: [{id,target,stagePath,reason}]
//           [, superseded][, failed][, logFailed][, manifestFailed][, prBodyStale]}
//   stage: {staged: [...][, superseded][, failed][, manifestFailed]}
//   failed — entries whose staged write failed too (they stay captured; the CLI exits 1)
//   manifestFailed — the manifest write failed after the work was done: landed[], pr and staged[] still
//                    hold (exit 0, never stage them again); a re-run of the same call records them,
//                    recognising each staged copy and logging nothing twice
//   prBodyStale — commits were added to the open PR but its body could not be rewritten: the landed
//                 entries stand; the caller names the PR in an open wrap-up ledger item
//   staged[] rows an earlier call already staged carry that call's stagePath (no second file or line)
//
// Exit 0 ok (every route above, staged included)
//      1 a git failure before the diff was read — nothing was changed; the caller commits on the run
//        branch and logs SKIP (degraded); merge-check's floor still holds that run. Also a failure
//        after the diff that staging could not absorb: stderr says "staging failed too" and where the edit is —
//        in the working tree (still committable on the run branch), or the patch file that holds it
//      2 malformed invocation, an unreadable --summary-file, a capture --target that is not a file under
//        .claude/skills/ (any other file is its own row's to commit or stage), or a --run that is
//        missing, not anchored under the main checkout (a worktree-local shadow), or not a directory —
//        nothing was changed
// The codes follow the Combined-2 vocabulary (.claude/skills/gh-api-module-pattern's CLI wrapper
// contract): 0 ok, 1 an operation failure, 2 a call to fix. --run is anchored strictly through
// lib/stage-item/write.js's resolveTarget (the sanctioned writers' predicate), but a refusal is exit 2,
// not the Sanctioned-writer family's 3: --run is an argument of this call, so re-resolving it and
// re-running the call is the whole recovery, the same as for any other bad flag. The staged line is
// written to decisions.md by the library, so the caller logs nothing on the staged route unless
// logFailed:true.
'use strict';

const fs = require('fs');
const path = require('path');
const { capture, realDeps: libDeps, UsageError, StagingFailure } = require('./lib/learned-skills/learned-skills');
const { land, stage } = require('./lib/learned-skills/land');
const { resolveTarget } = require('./lib/stage-item/write');

const USAGE = 'usage: learned-skills-pr.js capture --run <run-dir> --worktree <abs> --merge-base <sha> --target <repo-rel> --summary-file <path> [--row <row-id>]\n'
  + '       learned-skills-pr.js land --run <run-dir> --worktree <abs> --record <n> [--record <m> ...] --integration-branch <name> --merge-base <sha>\n'
  + '       learned-skills-pr.js stage --run <run-dir> --worktree <abs> --reason <text> --merge-base <sha>\n'
  + '  land / stage print one JSON line ({branch, pr, landed, staged} / {staged}); exit 1 when a staged write failed\n'
  + '  prints {route: run-branch | captured | clean | staged, ...}\n'
  + '  staged results may carry patch (the file holding the edit when the stage is description-only or unvalidated),\n'
  + '  residue:true (git status still lists the target) and logFailed:true (hand-log the STAGED line)\n'
  + '  exit 0 ok (staged included)\n'
  + '       1 git failure before the diff was read (nothing changed), or a failure after it that staging could not\n'
  + '         absorb ("staging failed too"; stderr says the edit is in the working tree, or names the file holding it)\n'
  + '       2 malformed invocation, a --target outside .claude/skills/, or refused --run\n';

const VERBS = {
  capture: ['--run', '--worktree', '--merge-base', '--target', '--summary-file'],
  land: ['--run', '--worktree', '--record', '--integration-branch', '--merge-base'],
  stage: ['--run', '--worktree', '--reason', '--merge-base'],
};
const FLAGS = {
  '--run': 'run', '--worktree': 'worktree', '--merge-base': 'mergeBase', '--target': 'target', '--summary-file': 'summaryFile',
  '--record': 'record', '--integration-branch': 'integrationBranch', '--reason': 'reason', '--row': 'row',
};
const REPEATABLE = new Set(['--record']);

function parseArgs(argv) {
  const o = { help: false, verb: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!a.startsWith('-') && o.verb === null) { o.verb = a; continue; }
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} needs a value` };
    if (REPEATABLE.has(a)) (o[FLAGS[a]] = o[FLAGS[a]] || []).push(v);
    else o[FLAGS[a]] = v;
    i++;
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined, // resolveTarget derives the main-checkout anchor from cwd
  resolveTarget,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  lib: libDeps,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const usageError = (message) => { deps.stderr(`learned-skills-pr.js: ${message}\n${USAGE}`); return 2; };

  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.verb) return usageError('a verb is required (capture, land, stage)');
  if (!Object.hasOwn(VERBS, o.verb)) return usageError(`unknown verb: ${o.verb}`);
  for (const flag of VERBS[o.verb]) if (!o[FLAGS[flag]]) return usageError(`${flag} is required`);

  let target;
  try {
    const cwd = deps.cwd();
    target = deps.resolveTarget({ runDir: path.resolve(cwd, o.run), cwd, mainRoot: deps.mainRoot });
  } catch (e) {
    return usageError((e && e.message) || String(e));
  }
  if (!target.ok) {
    return usageError(target.reason === 'missing'
      ? `--run dir does not exist or is not a directory: ${o.run}`
      : `--run ${o.run} is not anchored under the main checkout (a worktree-local shadow, or outside every checkout) — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path`);
  }

  if (o.verb !== 'capture') return runDelivery(o, target, deps, usageError);

  let summary;
  try { summary = deps.readFile(o.summaryFile); } catch (e) {
    return usageError(`could not read --summary-file: ${o.summaryFile} (${(e && e.message) || e})`);
  }

  try {
    const result = capture({
      runDir: target.dir, worktree: path.resolve(deps.cwd(), o.worktree), mergeBase: o.mergeBase, target: o.target, summary,
      ...(o.row ? { row: o.row } : {}),
    }, deps.lib);
    deps.stdout(JSON.stringify(result) + '\n');
    return 0;
  } catch (e) {
    if (e instanceof UsageError) return usageError(e.message);
    if (e instanceof StagingFailure) {
      deps.stderr(`learned-skills-pr.js: capture failed after the diff was read and staging failed too: ${e.message}\n`);
      return 1;
    }
    deps.stderr(`learned-skills-pr.js: capture failed before the diff was read — nothing was changed: ${(e && e.message) || e}\n`);
    return 1;
  }
}

// land / stage: one JSON line; exit 1 when a staged write failed (those entries stay captured) or a git/gh
// failure escaped the per-entry downgrades.
function runDelivery(o, target, deps, usageError) {
  const common = { runDir: target.dir, worktree: path.resolve(deps.cwd(), o.worktree), mergeBase: o.mergeBase };
  try {
    const result = o.verb === 'land'
      ? land({ ...common, record: o.record, integrationBranch: o.integrationBranch }, deps.lib)
      : stage({ ...common, reason: o.reason }, deps.lib);
    deps.stdout(JSON.stringify(result) + '\n');
    if (result.failed && result.failed.length) {
      deps.stderr(`learned-skills-pr.js: ${o.verb}: a staged write failed for ${result.failed.map((f) => `#${f.id} (${f.error})`).join(', ')} — those entries stay captured\n`);
      return 1;
    }
    return 0;
  } catch (e) {
    if (e instanceof UsageError) return usageError(e.message);
    deps.stderr(`learned-skills-pr.js: ${o.verb} failed: ${(e && e.message) || e}\n`);
    return 1;
  }
}

module.exports = { run, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
