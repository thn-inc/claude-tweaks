#!/usr/bin/env node
// bin/learned-skills-pr.js — keeps wrap-up's Skills-row edits off the run branch (#5290).
//
//   node bin/learned-skills-pr.js capture --run <run-dir> --worktree <abs> --merge-base <sha>
//     --target <repo-rel> --summary-file <path> [--help]
//
// `capture` moves one working-tree edit of a skill file into {run-dir}/learned-skills/{id}.patch and
// reverts it in the worktree. Stdout is one JSON line:
//   {route:'run-branch', reason:'record-owned'}   the record's own commits already touched the file —
//                                                 the edit stays on the run branch (caller commits it)
//   {route:'captured', id, patch, shared}         patch written, tree reverted; shared:true when the
//                                                 target was already captured in this run
//   {route:'clean'}                               nothing changed and nothing captured before
//   {route:'staged', stagePath, reason[, residue]} a failure after the diff was read: the edit is
//                                                 staged as staged/wrap-up-skill-{N}.md instead
// Exit 0 ok (every route above, staged included)
//      1 a git failure before the diff was read — nothing was changed; the caller commits on the run
//        branch and logs FAILED (merge-check's floor still holds that run)
//      2 malformed invocation, an unreadable --summary-file, or a --run that is missing, not anchored
//        under the main checkout (a worktree-local shadow), or not a directory
// --run is anchored strictly through lib/stage-item/write.js's resolveTarget (the sanctioned writers'
// predicate), with exit 2 for a refusal, as this CLI has no exit 3. The staged line is written to
// decisions.md by the library, so the caller logs nothing on the staged route.
'use strict';

const fs = require('fs');
const path = require('path');
const { capture, realDeps: libDeps, UsageError } = require('./lib/learned-skills/learned-skills');
const { resolveTarget } = require('./lib/stage-item/write');

const USAGE = 'usage: learned-skills-pr.js capture --run <run-dir> --worktree <abs> --merge-base <sha> --target <repo-rel> --summary-file <path>\n'
  + '  prints {route: run-branch | captured | clean | staged, ...}\n'
  + '  exit 0 ok, 1 git failure before the diff was read (nothing changed), 2 malformed invocation or refused --run\n';

const VERBS = new Set(['capture']);
const FLAGS = {
  '--run': 'run', '--worktree': 'worktree', '--merge-base': 'mergeBase', '--target': 'target', '--summary-file': 'summaryFile',
};
const REQUIRED = ['--run', '--worktree', '--merge-base', '--target', '--summary-file'];

function parseArgs(argv) {
  const o = { help: false, verb: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!a.startsWith('-') && o.verb === null) { o.verb = a; continue; }
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} needs a value` };
    o[FLAGS[a]] = v;
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
  if (!o.verb) return usageError('a verb is required (capture)');
  if (!VERBS.has(o.verb)) return usageError(`unknown verb: ${o.verb}`);
  for (const flag of REQUIRED) if (!o[FLAGS[flag]]) return usageError(`${flag} is required`);

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

  let summary;
  try { summary = deps.readFile(o.summaryFile); } catch (e) {
    return usageError(`could not read --summary-file: ${o.summaryFile} (${(e && e.message) || e})`);
  }

  try {
    const result = capture({
      runDir: target.dir, worktree: path.resolve(deps.cwd(), o.worktree), mergeBase: o.mergeBase, target: o.target, summary,
    }, deps.lib);
    deps.stdout(JSON.stringify(result) + '\n');
    return 0;
  } catch (e) {
    if (e instanceof UsageError) return usageError(e.message);
    deps.stderr(`learned-skills-pr.js: capture failed before the diff was read — nothing was changed: ${(e && e.message) || e}\n`);
    return 1;
  }
}

module.exports = { run, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
