#!/usr/bin/env node
// bin/pr-merge-state.js -- read a pr-first run's own PR merge state at a phase
// exit and classify it (#2986). A PR that conflicts with the integration branch
// gets no pull_request workflow runs from GitHub until the branch is caught up,
// so a pushed phase exit can look green while no CI ever started. Routed by
// skills/_shared/git-discipline.md's Post-push merge-state check (which owns
// what each state means to the caller). One resolver call through
// lib/reconcile/pr-state.js's resolvePrStateByNumber; UNKNOWN is never re-read
// (GitHub computes mergeability asynchronously -- a second read is the caller's
// call, not this CLI's).
//
//   node bin/pr-merge-state.js --run <run-dir> --phase <build|test|review|polish|wrap-up> [--help]
//
// Prints one JSON line: {state, pr, mergeable, mergeStateStatus, phase, logged,
// reason?}. state is conflicting | no-conflict | unknown | not-open | no-pr |
// read-failed | gh-absent. A PR that is not OPEN (closed or merged) is no signal:
// not-open, nothing written. On conflicting only, one AUTO entry naming the PR and
// phase is appended to the run dir's decisions.md (logged:true; false if the
// append threw).
//
// Status is data: exit 0 in every state, including no-pr and read-failed.
// 2 malformed invocation; 3 run dir missing or not anchored under the main
// checkout (a worktree-local shadow -- _shared/pipeline-run-dir.md, [IL-127]).
'use strict';

const { resolveTarget, formatEntry, appendEntry } = require('./lib/log-decision/append');
const { readRunStateWithParent } = require('./lib/hooks/context');
const { resolvePrStateByNumber } = require('./lib/reconcile/pr-state');

// phase -> the decisions.md section its entry lands under (polish runs inside /flow).
const PHASE_SECTIONS = { build: '/build', test: '/test', review: '/review', polish: '/flow', 'wrap-up': '/wrap-up' };

// Every `state` value this CLI can print — the one list the USAGE text, docs/plugin-structure.md,
// and the routing bullets of git-discipline.md's Post-push merge-state check are pinned equal to.
const STATES = Object.freeze(['conflicting', 'no-conflict', 'unknown', 'not-open', 'no-pr', 'read-failed', 'gh-absent']);

const USAGE = 'usage: pr-merge-state.js --run <run-dir> --phase <build|test|review|polish|wrap-up> [--help]\n'
  + '  prints {state, pr, mergeable, mergeStateStatus, phase, logged, reason?};\n'
  + `  state: ${STATES.join(' | ')}\n`
  + '  exit 0 in every state; 2 malformed invocation; 3 run dir missing or not anchored\n';

function parseArgs(argv) {
  const o = { run: null, phase: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = argv[++i] ?? null;
    else if (a === '--phase') o.phase = argv[++i] ?? null;
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const isStr = (v) => typeof v === 'string';

// A PR view -> conflicting | no-conflict | unknown. DIRTY / CONFLICTING is
// conclusive on either field; UNKNOWN, a missing field, or a non-string is no signal.
function classifyMergeState(view) {
  const mss = view && view.mergeStateStatus;
  const m = view && view.mergeable;
  if (mss === 'DIRTY' || m === 'CONFLICTING') return 'conflicting';
  if (!isStr(mss) || !isStr(m) || mss === 'UNKNOWN' || m === 'UNKNOWN') return 'unknown';
  return 'no-conflict';
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  readRunState: (runDir) => readRunStateWithParent(runDir, { requireRunIdParent: true }).state,
  resolvePrState: (repoRoot, n) => resolvePrStateByNumber(repoRoot, n),
  appendDecision: (args) => appendEntry(args),
  now: () => Date.now(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function report(deps, body) {
  deps.stdout(`${JSON.stringify({ pr: null, mergeable: null, mergeStateStatus: null, logged: false, ...body })}\n`);
  return 0;
}

function run(argv, overrides = {}) {
  // Tests pass only the seams they fake; readRunState stays the real
  // run-state.json reader unless a test overrides it.
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`pr-merge-state.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) { deps.stderr(`pr-merge-state.js: --run <run-dir> is required\n${USAGE}`); return 2; }
  if (!o.phase) { deps.stderr(`pr-merge-state.js: --phase <build|test|review|polish|wrap-up> is required\n${USAGE}`); return 2; }
  if (!Object.hasOwn(PHASE_SECTIONS, o.phase)) { deps.stderr(`pr-merge-state.js: invalid --phase: ${o.phase}\n${USAGE}`); return 2; }
  const phase = o.phase;
  const target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot });
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`pr-merge-state.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`pr-merge-state.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }
  let state = null;
  try { state = deps.readRunState(o.run); } catch { state = null; }
  const n = state && state.pr && state.pr.number;
  if (!Number.isInteger(n) || n <= 0) return report(deps, { state: 'no-pr', phase });
  let view;
  try { view = deps.resolvePrState(deps.cwd(), n); } catch { return report(deps, { state: 'read-failed', pr: n, phase, reason: 'resolver-threw' }); }
  if (view === null) return report(deps, { state: 'no-pr', phase });
  if (view === 'gh-absent') return report(deps, { state: 'gh-absent', pr: n, phase });
  if (view === 'network-failure' || view === 'invalid-arguments') return report(deps, { state: 'read-failed', pr: n, phase, reason: view });
  if (typeof view !== 'object') return report(deps, { state: 'read-failed', pr: n, phase, reason: 'unparseable' });
  const mergeable = isStr(view.mergeable) ? view.mergeable : null;
  const mergeStateStatus = isStr(view.mergeStateStatus) ? view.mergeStateStatus : null;
  // A closed or merged PR gets no pull_request runs whatever its mergeability says,
  // and a stale DIRTY on it is no signal for the run.
  if (isStr(view.state) && view.state !== 'OPEN') return report(deps, { state: 'not-open', pr: n, mergeable, mergeStateStatus, phase });
  const verdict = classifyMergeState(view);
  const body = { state: verdict, pr: n, mergeable, mergeStateStatus, phase };
  if (verdict !== 'conflicting') return report(deps, body);
  let logged = false;
  try {
    const entry = formatEntry({
      status: 'AUTO',
      now: deps.now(),
      step: 'Post-push merge-state check',
      text: `PR #${n} conflicts with the integration branch at ${phase} exit (mergeStateStatus ${mergeStateStatus}, mergeable ${mergeable}) — GitHub runs no pull_request workflows on it until the branch is caught up`,
      reversibility: 'n/a',
    });
    deps.appendDecision({ runDir: o.run, section: PHASE_SECTIONS[phase], entry });
    logged = true;
  } catch (e) {
    deps.stderr(`pr-merge-state.js: could not append the decisions.md entry: ${(e && e.message) || e}\n`);
  }
  return report(deps, { ...body, logged });
}

module.exports = { run, parseArgs, classifyMergeState, PHASE_SECTIONS, STATES };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
