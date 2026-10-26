#!/usr/bin/env node
// bin/evidence-route.js -- decide where verification-brief Step 4's demo-evidence
// screenshots go: committed to the current branch, or to a dedicated evidence PR
// (#4125). The decision itself is lib/wrap-up/evidence-route.js's pure
// decideEvidenceRoute; this CLI only gathers its six inputs, so the prose that
// calls it never re-derives a rule.
//
//   node bin/evidence-route.js [--run <run-dir>] [--in-run] [--leave-open] [--help]
//
// Prints one JSON line: {route, branch, state, reason}. route is current-branch |
// evidence-pr; reason names the guard or state that decided it. With --run the
// run PR's merge state comes from pr-merge-state.js (run in-process, phase
// wrap-up -- it appends its own decisions.md lines: AUTO on conflicting, SKIP on
// unknown | read-failed | gh-absent); a run with no PR, or no --run, falls back to
// the current branch's own PR (lib/reconcile/pr-state.js's resolvePrState).
// --in-run marks a call from wrap-up Phase 4 execution's Acceptance-labeling
// bullet; --leave-open marks an attended Review Console that chose "Approve all,
// leave PR open" (console.json records only the resolver's choice).
//
// Status is data: exit 0 in every route. 2 malformed invocation; 3 run dir
// missing or not anchored under the main checkout (a worktree-local shadow --
// _shared/pipeline-run-dir.md, [IL-127]). Every git/gh read that fails folds into
// the decision (no-branch, integration-branch-unresolved, read-failed) and so
// fails toward the evidence PR.
'use strict';

const { execFileSync } = require('child_process');
const { resolveTarget } = require('./lib/log-decision/append');
const { readRunStateWithParent } = require('./lib/hooks/context');
const { GIT_TIMEOUT_MS } = require('./lib/shared-primitives');
const { canonicalRealpath } = require('./lib/path-guard');
const { resolvePrState } = require('./lib/reconcile/pr-state');
const { resolveIntegrationBranch, bareIntegrationName } = require('./lib/hooks/worktree-reap');
const { consoleMergeResolution } = require('./lib/wrap-up/engine-verify');
const prMergeState = require('./pr-merge-state');
const {
  STATES, ROUTES, REASONS, decideEvidenceRoute, branchReadState,
} = require('./lib/wrap-up/evidence-route');

const USAGE = 'usage: evidence-route.js [--run <run-dir>] [--in-run] [--leave-open] [--help]\n'
  + '  prints {route, branch, state, reason}\n'
  + `  route: ${ROUTES.join(' | ')}\n`
  + `  reason: ${REASONS.join(' | ')}\n`
  + `  state: ${STATES.join(' | ')}\n`
  + '  --run: read the run PR via pr-merge-state.js (run in-process; it appends its own decisions.md lines under /wrap-up:\n'
  + '    AUTO on conflicting, SKIP on unknown | read-failed | gh-absent)\n'
  + '  --in-run: this call comes from wrap-up Phase 4 execution; --leave-open: an attended console chose "Approve all, leave PR open"\n'
  + '  exit 0 in every route; 2 malformed invocation; 3 run dir missing or not anchored\n';

function parseArgs(argv) {
  const o = { run: null, inRun: false, leaveOpen: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--in-run') o.inRun = true;
    else if (a === '--leave-open') o.leaveOpen = true;
    else if (a === '--run') {
      const v = argv[++i];
      if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: '--run needs a <run-dir> value' };
      o.run = v;
    } else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  git: (args) => execFileSync('git', args, {
    cwd: realDeps.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GIT_TIMEOUT_MS, windowsHide: true,
  }),
  readRunState: (runDir) => readRunStateWithParent(runDir, { requireRunIdParent: true }).state,
  prMergeStateRun: (argv, subDeps) => prMergeState.run(argv, subDeps),
  resolveBranchPr: (repoRoot, branch) => resolvePrState(repoRoot, branch),
  integrationBranch: (repoRoot) => bareIntegrationName(resolveIntegrationBranch(repoRoot)),
  consoleResolution: (runDir) => consoleMergeResolution(runDir),
  canonical: (p) => canonicalRealpath(p),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// pr-merge-state.js run in-process with its stdout captured; its last stdout line is
// its JSON. Anything but a clean exit 0 with a parsed object reads as read-failed.
function runPrMergeState(deps, runDir) {
  const out = [];
  let exit;
  try {
    exit = deps.prMergeStateRun(['--run', runDir, '--phase', 'wrap-up'], {
      cwd: deps.cwd, mainRoot: deps.mainRoot, stdout: (s) => out.push(s), stderr: (s) => deps.stderr(s),
    });
  } catch { return 'read-failed'; }
  if (exit !== 0) return 'read-failed';
  const last = out.join('').trim().split('\n').pop();
  const parsed = attempt(() => JSON.parse(last), null);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return 'read-failed';
  return typeof parsed.state === 'string' ? parsed.state : 'read-failed';
}

function attempt(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`evidence-route.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }

  // The canonical form when it resolves, else the raw path.
  function canonicalOrRaw(p) {
    return attempt(() => deps.canonical(p), null) || p;
  }

  let worktree = null;
  let state = null;
  let consoleResolution = null;
  if (o.run !== null) {
    const target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot });
    if (!target.ok) {
      if (target.reason === 'missing') deps.stderr(`evidence-route.js: run dir does not exist: ${o.run}\n`);
      else deps.stderr(`evidence-route.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
      return 3;
    }
    const runState = attempt(() => deps.readRunState(o.run), null);
    worktree = runState && typeof runState.worktree === 'string' && runState.worktree ? runState.worktree : null;
    state = runPrMergeState(deps, o.run);
    consoleResolution = attempt(() => deps.consoleResolution(o.run), null);
  }

  const currentBranch = attempt(() => String(deps.git(['branch', '--show-current'])).trim(), '');
  let toplevel = attempt(() => String(deps.git(['rev-parse', '--show-toplevel'])).trim(), null);
  if (toplevel !== null) toplevel = canonicalOrRaw(toplevel);
  if (worktree !== null) worktree = canonicalOrRaw(worktree);

  if (o.run === null || state === 'no-pr') {
    state = branchReadState(attempt(() => deps.resolveBranchPr(deps.cwd(), currentBranch || null), 'read-failed'));
  }

  const integrationBranch = attempt(() => deps.integrationBranch(deps.cwd()), null);
  deps.stdout(`${JSON.stringify(decideEvidenceRoute({
    currentBranch, integrationBranch, toplevel, worktree, state, inRun: o.inRun, leaveOpen: o.leaveOpen, consoleResolution,
  }))}\n`);
  return 0;
}

module.exports = { run, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
