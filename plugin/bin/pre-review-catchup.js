#!/usr/bin/env node
// bin/pre-review-catchup.js -- before the whole-branch review, merge any
// origin/{integration-branch} commits that touch files the build branch changed
// (#4304), so the review judges the tree the branch will land as. Run from the
// build checkout (the worktree); the integration branch comes only from
// --integration-branch -- this CLI never guesses it. The git work lives in
// lib/worktree/pre-review-catchup.js; this shell parses args, prints the body and
// writes the decisions.md trail.
//
//   node bin/pre-review-catchup.js --integration-branch <b> [--run <run-dir>] [--help]
//
// Prints one JSON line: {outcome, integrationBranch, before, after, mergeBase,
// reviewBase, upstreamCommits, branchFileCount, overlapCommits, overlapFiles,
// conflictFiles, reason, logged, line, entry} (+ logError when --run was passed and
// the append was refused or threw). outcome is not-applicable | fetch-failed |
// windows-longpath | dirty-tree | no-overlap | merged | conflict. `line` is the
// formatted decisions.md entry and `entry` its parts ({status, text, step,
// reversibility, section}, one log-decision.js --entries element that reproduces
// `line`); with --run the CLI appends it under /build and sets logged:true, without
// --run nothing is written and the caller reports `line`
// (_shared/worktree-catchup-no-run-dir.md).
//
// Status is data: exit 0 on every outcome, including conflict (the merge is left
// in progress for the caller to resolve; reason merge-in-progress when it already
// was at entry, with conflictFiles empty once resolved but not committed) and dirty-tree. A refused or unanchored
// --run, or a failed append, never changes the exit code: logged:false, logError,
// and one stderr line. 2 malformed invocation (git is never spawned); 1 only for
// an undecided crash -- a git error outside the fetch, or a failed merge with no
// unmerged paths.
'use strict';

const { resolveTarget, formatEntry, appendEntry } = require('./lib/log-decision/append');
const { isValidBranchName } = require('./lib/init/release-bootstrap');
const { OUTCOMES, runCatchup, formatLine, makeGit } = require('./lib/worktree/pre-review-catchup');

const SECTION = '/build';
const STEP = 'Pre-review catch-up';
const NAME = 'pre-review-catchup.js';

const USAGE = `usage: ${NAME} --integration-branch <b> [--run <run-dir>] [--help]\n`
  + '  prints {outcome, integrationBranch, before, after, mergeBase, reviewBase, upstreamCommits,\n'
  + '          branchFileCount, overlapCommits, overlapFiles, conflictFiles, reason, logged, line, entry, logError?};\n'
  + `  outcome: ${OUTCOMES.join(' | ')}\n`
  + '  with --run, appends the entry to decisions.md under /build; without it, logs nothing\n'
  + '  exit 0 on every outcome (status is data); 2 malformed invocation; 1 undecided git failure\n';

const VALUE_FLAGS = { '--integration-branch': 'integrationBranch', '--run': 'run' };

function parseArgs(argv) {
  const o = { integrationBranch: null, run: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      o.help = true;
    } else if (Object.hasOwn(VALUE_FLAGS, a)) {
      const v = argv[++i];
      if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} needs a value` };
      // Anything that is not a branch name would reach `git fetch` as a refspec
      // (`main:refs/heads/x`) or an option (`-v`); isValidBranchName also rejects a leading `-`.
      if (a === '--integration-branch' && !isValidBranchName(v)) return { error: `${a} is not a branch name: ${v}` };
      o[VALUE_FLAGS[a]] = v;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return o;
}

// No `git` here: run() binds the real one to deps.cwd(), so an injected cwd is the checkout git runs in.
const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  appendDecision: (args) => appendEntry(args),
  now: () => Date.now(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function report(deps, body) {
  deps.stdout(`${JSON.stringify(body)}\n`);
  return 0;
}

// Append the entry under /build; returns '' on success or the reason it was not
// written. A refusal or a throw never changes the exit code or the outcome.
function appendLine(deps, runDir, entry) {
  try {
    const target = resolveTarget({ runDir, cwd: deps.cwd(), mainRoot: deps.mainRoot });
    if (!target.ok) {
      return target.reason === 'missing'
        ? `run dir does not exist: ${runDir}`
        : `run dir is not anchored under the main checkout (a worktree-local shadow): ${runDir} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path`;
    }
    deps.appendDecision({ runDir, section: SECTION, entry });
    return '';
  } catch (e) {
    return String((e && e.message) || e);
  }
}

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`${NAME}: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.integrationBranch) { deps.stderr(`${NAME}: --integration-branch <b> is required\n${USAGE}`); return 2; }

  let body;
  try {
    body = runCatchup({ integrationBranch: o.integrationBranch }, { git: deps.git || makeGit(deps.cwd()) });
  } catch (e) {
    deps.stderr(`${NAME}: ${(e && e.message) || e}\n`);
    return 1;
  }
  const { status, text, reversibility } = formatLine(body);
  const entry = formatEntry({ status, text, reversibility, now: deps.now(), step: STEP });
  // `entry` holds line's parts, a ready --entries element for the logged:false hand-log.
  const out = { ...body, logged: false, line: entry, entry: { status, text, step: STEP, reversibility, section: SECTION } };
  if (o.run) {
    const logError = appendLine(deps, o.run, entry);
    if (logError) {
      out.logError = logError;
      deps.stderr(`${NAME}: could not append the decisions.md entry: ${logError}\n`);
    } else {
      out.logged = true;
    }
  }
  return report(deps, out);
}

module.exports = { run, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
