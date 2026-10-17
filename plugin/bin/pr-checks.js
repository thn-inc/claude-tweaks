#!/usr/bin/env node
// bin/pr-checks.js -- read a pr-first run's own PR check rollup at HEAD and
// classify it (#3013). The one shared read /claude-tweaks:test's pipeline
// gate and /claude-tweaks:review Step 1.5 both run, per
// skills/_shared/pr-check-gate.md (which owns how each state is routed).
// Classification rules: _shared/pr-first-merge.md Step 2.5, via
// lib/pr-checks/classify.js; the merge gate keeps its own read. It also lists
// the workflow runs for the head sha (`gh run list --commit`, #3405), so a
// workflow the rollup has not registered yet reads pending, not green.
//
//   node bin/pr-checks.js --run <run-dir> [--help]
//
// Prints one JSON line: {state, failing:[{name,url}], pending:[name],
// headRefOid, localHead, pr, reason?}. state is red | pending | stale |
// green | no-ci | read-failed | no-pr | gh-absent.
//
// Status is data: exit 0 in every state, including no-pr and read-failed.
// 2 malformed invocation; 3 run dir missing or not anchored under the main
// checkout (a worktree-local shadow -- _shared/pipeline-run-dir.md, [IL-127]).
'use strict';

const { execFileSync } = require('child_process');
const { classifyRollup } = require('./lib/pr-checks/classify');
const { resolveTarget } = require('./lib/log-decision/append');
const { readRunStateWithParent } = require('./lib/hooks/context');
const { ghAvailable } = require('./lib/repo-resolve');
const { hasPullRequestCi } = require('./lib/merge-verification');
const { GH_TIMEOUT_MS, GIT_TIMEOUT_MS } = require('./lib/shared-primitives');

const USAGE = 'usage: pr-checks.js --run <run-dir> [--help]\n'
  + '  prints {state, failing, pending, headRefOid, localHead, pr, reason?};\n'
  + '  state: red | pending | stale | green | no-ci | read-failed | no-pr | gh-absent\n'
  + '  exit 0 in every state; 2 malformed invocation; 3 run dir missing or not anchored\n';

function parseArgs(argv) {
  const o = { run: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = argv[++i] ?? null;
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const QUIET = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  ghAvailable: () => ghAvailable(),
  hasPullRequestCi: (root) => hasPullRequestCi(root),
  gh: (args) => execFileSync('gh', args, { ...QUIET, timeout: GH_TIMEOUT_MS, windowsHide: true }),
  git: (args) => execFileSync('git', args, { ...QUIET, timeout: GIT_TIMEOUT_MS, windowsHide: true }),
  readRunState: (runDir) => readRunStateWithParent(runDir, { requireRunIdParent: true }).state,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function errText(e) {
  return [e && e.message, e && e.stderr, e && e.stdout].filter(Boolean).join(' ').trim() || String(e);
}

function report(deps, body) {
  deps.stdout(`${JSON.stringify({ failing: [], pending: [], headRefOid: null, localHead: null, pr: null, ...body })}\n`);
  return 0;
}

function run(argv, overrides = {}) {
  // Tests pass only the seams they fake; readRunState stays the real
  // run-state.json reader unless a test overrides it.
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`pr-checks.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) { deps.stderr(`pr-checks.js: --run <run-dir> is required\n${USAGE}`); return 2; }
  const target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot });
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`pr-checks.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`pr-checks.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }
  let state = null;
  try { state = deps.readRunState(o.run); } catch { state = null; }
  const n = state && state.pr && state.pr.number;
  if (!Number.isInteger(n) || n <= 0) return report(deps, { state: 'no-pr' });
  if (!deps.ghAvailable()) return report(deps, { state: 'gh-absent', pr: n });
  let localHead;
  try { localHead = String(deps.git(['rev-parse', 'HEAD'])).trim(); } catch (e) {
    return report(deps, { state: 'read-failed', pr: n, reason: `local HEAD unreadable: ${errText(e)}` });
  }
  let view;
  try { view = JSON.parse(deps.gh(['pr', 'view', String(n), '--json', 'headRefOid,statusCheckRollup'])); } catch (e) {
    return report(deps, { state: 'read-failed', pr: n, localHead, reason: `gh pr view failed: ${errText(e)}` });
  }
  // The full 40-char sha: an abbreviated --commit lists no runs (#3405).
  const headRefOid = view && view.headRefOid;
  let headRuns;
  let runsFailure = null;
  // A stale head skips the runs read: the classifier concludes nothing from it,
  // so a transient runs-read failure must not turn `stale` into `read-failed`.
  if (typeof headRefOid === 'string' && headRefOid && headRefOid === localHead) {
    try {
      const rows = JSON.parse(deps.gh(['run', 'list', '--commit', headRefOid, '--limit', '100', '--json', 'name,workflowName,status,conclusion,url']));
      if (!Array.isArray(rows)) throw new Error('not a JSON array');
      headRuns = rows;
    } catch (e) {
      runsFailure = `gh run list failed: ${errText(e)}`;
    }
  }
  let repoRoot = deps.cwd();
  try { repoRoot = String(deps.git(['rev-parse', '--show-toplevel'])).trim(); } catch { repoRoot = deps.cwd(); }
  let hasPrCi = false;
  try { hasPrCi = Boolean(deps.hasPullRequestCi(repoRoot)); } catch { hasPrCi = false; }
  const verdict = classifyRollup({ rollup: view && view.statusCheckRollup, headRefOid, localHead, hasPrCi, headRuns });
  // A failed runs read cannot conclude green/pending, but a rollup that is already red is conclusive on its own.
  if (runsFailure && verdict.state !== 'red') return report(deps, { state: 'read-failed', pr: n, localHead, reason: runsFailure });
  return report(deps, { ...verdict, localHead, pr: n });
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
