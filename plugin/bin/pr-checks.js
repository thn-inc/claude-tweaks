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
//   node bin/pr-checks.js --run <run-dir> [--section "/<skill>"] | --pr <n> [--help]
//
// --pr <n> (#3469) classifies a PR by number for display-only readers that hold
// a PR number and no local checkout of its branch: same JSON, `localHead: null`,
// and the PR's own headRefOid stands in for local HEAD, so `stale` and `no-pr`
// cannot occur. Exactly one of --run / --pr is required.
//
// Prints one JSON line: {state, failing:[{name,url,inherited?}], pending:[name],
// awaitingReadyRun?:[workflow file], headRefOid, localHead, pr, reason?, baseBranch?, baseSha?, baseReason?,
// headRunCount?, logged? (--run only)}. headRunCount is the number of workflow runs the
// head-runs read listed for headRefOid (one page of 100), present only when that read
// succeeded -- drive.js's CI step reads it rather than listing the runs itself. state
// is red | inherited-red | pending | stale | green | no-ci | read-failed | no-pr
// | gh-absent.
//
// A `red` read also reads the base branch tip's checks (#3258) and marks each
// failing check `inherited` when it also fails there; every failing check
// inherited is `inherited-red`. The base is the branch the PR merges into (its
// `baseRefName`), the integration-branch resolver only when the PR view carries
// none; `baseBranch` names the branch actually compared. A failed or truncated
// base read leaves plain `red` with a baseReason -- never green. Only the newest
// run of a workflow counts at the base tip (classify.js). Only `red` triggers the
// base read. A failed head-runs read that would leave a non-red verdict
// (including inherited-red) is `read-failed`: the read is partial.
//
// The ready-run inputs (#5153): when the PR has a ready event and a workflow its
// ready transition must run (lib/pr-checks/ready-run.js), readySince /
// readyWorkflows / the REST runs reach classifyRollup, and a pending envelope
// gains awaitingReadyRun (the workflow files with no run since ready). A
// draft-skip workflow without a ready trigger is folded in with the ready ones
// (Reading B): pending while it has no post-ready run, judged by the general
// rules once a later push has run it -- so this gate and the merge gate's
// ready-run reader agree on every head; only the merge gate names the
// no-post-ready-run case with its own park reason. A failed ready-run read
// demotes a non-red verdict to read-failed, like the head-runs read.
//
// Under --run (#4026) the CLI writes the gate's own decisions.md line, step
// "PR-check gate", under --section (no heading without it) -- the line
// _shared/pr-check-gate.md routes each state to: inherited-red, pending and stale
// one AUTO caveat (reversibility high); no-pr, gh-absent, no-ci and read-failed
// one SKIP degrade trace (n/a); green and red nothing. The envelope then gains
// logged: true when the entry landed, false when the state logs nothing or the
// append threw (one stderr line; exit code unchanged). --pr never writes and
// never carries logged, so its envelope stays byte-identical. --section is valid
// only with --run.
//
// Status is data: exit 0 in every state, including no-pr and read-failed.
// 2 malformed invocation; 3 run dir missing or not anchored under the main
// checkout (a worktree-local shadow -- _shared/pipeline-run-dir.md, [IL-127]).
'use strict';

const { execFileSync } = require('child_process');
const { classifyRollup, failingNamesAt, applyBaseComparison } = require('./lib/pr-checks/classify');
const { resolveIntegrationBranch, bareIntegrationName } = require('./lib/hooks/worktree-reap');
const { resolveTarget, formatEntry, appendEntry } = require('./lib/log-decision/append');
const { readRunStateWithParent } = require('./lib/hooks/context');
const { ghAvailable, ghOptions } = require('./lib/repo-resolve');
const { hasPullRequestCi, readyRequirement } = require('./lib/merge-verification');
const { readReadyRun, readyWaitSet, defaultDeps: readyRunDeps } = require('./lib/pr-checks/ready-run');
const { GH_TIMEOUT_MS, GIT_TIMEOUT_MS } = require('./lib/shared-primitives');

const USAGE = 'usage: pr-checks.js --run <run-dir> [--section "/<skill>"] | --pr <n> [--help]\n'
  + '  --pr <n> classifies a PR by number with no run dir: local HEAD is not compared (the PR\'s own head stands in), localHead is null, never stale, never no-pr\n'
  + '  prints {state, failing, pending, awaitingReadyRun?, headRefOid, localHead, pr, reason?, baseBranch?, baseSha?, baseReason?, headRunCount?, logged? (--run only)};\n'
  + '  headRunCount: the head sha\'s workflow-run count, present only when the head-runs read succeeded;\n'
  + '  baseBranch: the branch compared on a red read -- the PR\'s own base, else the integration branch;\n'
  + '  state: red | inherited-red | pending | stale | green | no-ci | read-failed | no-pr | gh-absent\n'
  + '  --run appends the PR-check gate line to decisions.md under --section and adds logged: AUTO on inherited-red | pending | stale; SKIP on no-pr | gh-absent | no-ci | read-failed\n'
  + '  exit 0 in every state; 2 malformed invocation; 3 run dir missing or not anchored\n';

function parseArgs(argv) {
  const o = { run: null, pr: null, section: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = argv[++i] ?? null;
    else if (a === '--pr') {
      const v = argv[++i];
      if (!/^[1-9]\d*$/.test(v ?? '')) return { error: `--pr needs a positive integer, got: ${v ?? '(none)'}` };
      o.pr = Number(v);
    } else if (a === '--section') {
      const v = argv[++i];
      if (typeof v !== 'string' || !v.trim() || /[\r\n]/.test(v)) return { error: `--section needs a value ("/<skill>"), got: ${v === undefined ? '(none)' : JSON.stringify(v)}` };
      o.section = v;
    } else return { error: `unknown argument: ${a}` };
  }
  if (o.run !== null && o.pr !== null) return { error: '--run and --pr are mutually exclusive' };
  if (o.section !== null && o.run === null) return { error: '--section is valid only with --run' };
  return o;
}

const QUIET = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  ghAvailable: () => ghAvailable(),
  hasPullRequestCi: (root) => hasPullRequestCi(root),
  integrationBranch: (repoRoot) => bareIntegrationName(resolveIntegrationBranch(repoRoot)),
  gh: (args) => execFileSync('gh', args, ghOptions(args, { ...QUIET, timeout: GH_TIMEOUT_MS, windowsHide: true })),
  git: (args) => execFileSync('git', args, { ...QUIET, timeout: GIT_TIMEOUT_MS, windowsHide: true }),
  readyRun: (a) => readReadyRun(readyRunDeps(a.root), a),
  readRunState: (runDir) => readRunStateWithParent(runDir, { requireRunIdParent: true }).state,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  appendDecision: (args) => appendEntry(args),
  now: () => Date.now(),
};

function errText(e) {
  return [e && e.message, e && e.stderr, e && e.stdout].filter(Boolean).join(' ').trim() || String(e);
}

// The base branch tip's failing check names (#3258): { branch, sha, failing } on
// a full read, { branch, sha, reason } at the first failed step. The base is the
// branch the PR actually merges into (`baseRefName`); the integration-branch
// resolver is only the fallback when the PR view carried none. Never throws --
// the caller maps a reason to plain red, so a failed read can only keep a
// verdict red, never soften it.
function readBase(deps, repoRoot, prBase) {
  let branch = typeof prBase === 'string' && prBase ? prBase : null;
  if (!branch) { try { branch = deps.integrationBranch(repoRoot); } catch { branch = null; } }
  if (typeof branch !== 'string' || !branch) return { branch: null, sha: null, reason: 'integration branch unresolvable' };
  let sha = null;
  try {
    // A ref name may legally carry `#` or `%`; encode each path segment so the tip read cannot resolve another branch.
    const refPath = branch.split('/').map(encodeURIComponent).join('/');
    const out = String(deps.gh(['api', `repos/{owner}/{repo}/commits/${refPath}`, '--jq', '.sha'])).trim();
    if (!/^[0-9a-f]{40}$/.test(out)) return { branch, sha: null, reason: `base sha unreadable: ${out.slice(0, 200)}` };
    sha = out;
    const checkRunsPage = JSON.parse(deps.gh(['api', `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`]));
    const statusPage = JSON.parse(deps.gh(['api', `repos/{owner}/{repo}/commits/${sha}/status?per_page=100`]));
    const checkRuns = checkRunsPage.check_runs;
    const statuses = statusPage.statuses;
    // One page only: a truncated list would drop failing names and under-report what is inherited, so say so instead.
    if (Array.isArray(checkRuns) && checkRunsPage.total_count > checkRuns.length) return { branch, sha, reason: `base check-runs truncated: ${checkRuns.length} of ${checkRunsPage.total_count}` };
    if (Array.isArray(statuses) && statusPage.total_count > statuses.length) return { branch, sha, reason: `base statuses truncated: ${statuses.length} of ${statusPage.total_count}` };
    const runs = JSON.parse(deps.gh(['run', 'list', '--commit', sha, '--limit', '100', '--json', 'databaseId,name,workflowName,status,conclusion,url']));
    return { branch, sha, failing: failingNamesAt({ checkRuns, statuses, runs }) };
  } catch (e) {
    return { branch, sha, reason: `base read failed: ${errText(e)}` };
  }
}

const DEGRADED = Object.freeze(['no-pr', 'gh-absent', 'no-ci', 'read-failed']);
const short = (sha) => String(sha).slice(0, 7);

// The decisions.md line _shared/pr-check-gate.md routes a state to, or null (green, red).
function gateEntry(out) {
  const { state, pr } = out;
  if (state === 'inherited-red') {
    return { status: 'AUTO', reversibility: 'high', text: `PR #${pr} checks red at ${short(out.headRefOid)}, but every failing check (${out.failing.map((f) => f.name).join(', ')}) is also failing on ${out.baseBranch} at ${short(out.baseSha)} — inherited, passed with caveat` };
  }
  if (state === 'pending' || state === 'stale') {
    const awaiting = Array.isArray(out.awaitingReadyRun) && out.awaitingReadyRun.length ? `no run since ready: ${out.awaitingReadyRun.join(', ')}` : null;
    return { status: 'AUTO', reversibility: 'high', text: `PR #${pr} checks ${state} at ${short(out.headRefOid)} (${out.pending.length ? out.pending.join(', ') : (state === 'stale' ? 'HEAD not yet pushed' : (awaiting || 'no check reported yet'))}) — passed with caveat` };
  }
  if (DEGRADED.includes(state)) {
    return { status: 'SKIP', reversibility: 'n/a', text: `condition: pr-checks.js ${state}${out.reason ? `: ${out.reason}` : ''} → fallback: local verification only` };
  }
  return null;
}

// true when the gate's entry landed. A failed append never changes the exit code
// or the state -- one stderr line, logged:false. A forge-supplied reason can carry
// line breaks (gh stderr); collapsed, so the entry stays one decisions.md line.
function logGateEntry(deps, { runDir, section }, out) {
  const e = gateEntry(out);
  if (!e) return false;
  try {
    const entry = formatEntry({ status: e.status, now: deps.now(), step: 'PR-check gate', text: e.text.replace(/\s+/g, ' '), reversibility: e.reversibility });
    deps.appendDecision({ runDir, section, entry });
    return true;
  } catch (err) {
    deps.stderr(`pr-checks.js: could not append the decisions.md entry: ${(err && err.message) || err}\n`);
    return false;
  }
}

// audit: { runDir, section } under --run, null under --pr (no write, no logged key).
function report(deps, body, audit = null) {
  const out = { failing: [], pending: [], headRefOid: null, localHead: null, pr: null, ...body };
  if (audit) out.logged = logGateEntry(deps, audit, out);
  deps.stdout(`${JSON.stringify(out)}\n`);
  return 0;
}

// The shared tail of both modes: gh pr view -> head runs -> classify -> red-only
// base read -> report. `localHead` is the local checkout's HEAD (--run), or null
// (--pr, #3469): the PR's own headRefOid then stands in for it, so `stale` cannot
// occur and the reported localHead stays null.
function classifyPr(deps, n, localHead, audit) {
  let view;
  try { view = JSON.parse(deps.gh(['pr', 'view', String(n), '--json', 'headRefOid,statusCheckRollup,baseRefName'])); } catch (e) {
    return report(deps, { state: 'read-failed', pr: n, localHead, reason: `gh pr view failed: ${errText(e)}` }, audit);
  }
  // The full 40-char sha: an abbreviated --commit lists no runs (#3405).
  const headRefOid = view && view.headRefOid;
  const compareHead = localHead === null ? headRefOid : localHead;
  let repoRoot = deps.cwd();
  try { repoRoot = String(deps.git(['rev-parse', '--show-toplevel'])).trim(); } catch { repoRoot = deps.cwd(); }
  let headRuns;
  let runsFailure = null;
  let ready = null;
  let readyFailure = null;
  // A stale head skips the runs read: the classifier concludes nothing from it,
  // so a transient runs-read failure must not turn `stale` into `read-failed`.
  if (typeof headRefOid === 'string' && headRefOid && headRefOid === compareHead) {
    try {
      const rows = JSON.parse(deps.gh(['run', 'list', '--commit', headRefOid, '--limit', '100', '--json', 'name,workflowName,status,conclusion,url']));
      if (!Array.isArray(rows)) throw new Error('not a JSON array');
      headRuns = rows;
    } catch (e) {
      runsFailure = `gh run list failed: ${errText(e)}`;
    }
    // The ready-run read (#5153) is a corroborating read like the runs read: a
    // failure of it can only demote a non-red verdict, never soften a red one.
    if (!runsFailure) {
      try {
        const r = deps.readyRun({ pr: n, sha: headRefOid, root: repoRoot });
        if (!r || typeof r !== 'object') readyFailure = 'ready-run read failed: no result';
        else if (r.reason) readyFailure = `ready-run read failed: ${r.reason}`;
        else ready = r;
      } catch (e) {
        readyFailure = `ready-run read failed: ${errText(e)}`;
      }
    }
  }
  let hasPrCi = false;
  try { hasPrCi = Boolean(deps.hasPullRequestCi(repoRoot)); } catch { hasPrCi = false; }
  const input = { rollup: view && view.statusCheckRollup, headRefOid, localHead: compareHead, hasPrCi, headRuns };
  if (ready) {
    // The wait set is ready-run.js's readyWaitSet: a draft-skip workflow without a ready trigger is folded in
    // with the ready ones (Reading B). With no post-ready run it is awaiting (pending); once a later push has
    // run it, the general rules judge that run. This is the verdict the merge gate's ready-run reader gives
    // (same helper, so the two cannot disagree on what is awaited); only the merge gate names the
    // no-post-ready-run case with its own park reason. A run in both shapes (gh row + REST row) is named
    // once by the general scans (they dedupe by name), so the REST rows are appended, never substituted.
    const readyWorkflows = readyWaitSet(readyRequirement(ready.workflows));
    if (ready.readySince && readyWorkflows.length > 0) {
      input.readySince = ready.readySince;
      input.readyWorkflows = readyWorkflows;
      input.headRuns = [...(headRuns || []), ...(Array.isArray(ready.headRuns) ? ready.headRuns : [])];
    }
  }
  const verdict = classifyRollup(input);
  // Only a red verdict reads the base tip (#3258): green/pending/stale never change on it.
  let final = verdict;
  if (verdict.state === 'red') {
    const base = readBase(deps, repoRoot, view && view.baseRefName);
    final = { ...applyBaseComparison(verdict, base), baseBranch: base.branch };
  }
  // A failed runs read cannot conclude a pass-class verdict (green/pending/inherited-red): a failing run
  // absent from the rollup would be invisible. Only a verdict still red is conclusive on its own.
  if (runsFailure && final.state !== 'red') return report(deps, { state: 'read-failed', pr: n, localHead, reason: runsFailure }, audit);
  // The head-runs count rides every envelope whose runs read succeeded, so a caller can tell
  // "no workflow run on this sha" from "the runs could not be read" without listing them again.
  const runCount = Array.isArray(headRuns) ? { headRefOid, headRunCount: headRuns.length } : {};
  // Same for the ready-run read: a green or pending verdict could hide a ready-run failure.
  if (readyFailure && final.state !== 'red') return report(deps, { state: 'read-failed', pr: n, localHead, reason: readyFailure, ...runCount }, audit);
  return report(deps, { ...final, localHead, pr: n, ...runCount }, audit);
}

function run(argv, overrides = {}) {
  // Tests pass only the seams they fake; readRunState stays the real
  // run-state.json reader unless a test overrides it.
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`pr-checks.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (o.pr !== null) {
    if (!deps.ghAvailable()) return report(deps, { state: 'gh-absent', pr: o.pr });
    return classifyPr(deps, o.pr, null, null);
  }
  if (!o.run) { deps.stderr(`pr-checks.js: exactly one of --run <run-dir> or --pr <n> is required\n${USAGE}`); return 2; }
  const target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot });
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`pr-checks.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`pr-checks.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }
  const audit = { runDir: o.run, section: o.section };
  let state = null;
  try { state = deps.readRunState(o.run); } catch { state = null; }
  const n = state && state.pr && state.pr.number;
  if (!Number.isInteger(n) || n <= 0) return report(deps, { state: 'no-pr' }, audit);
  if (!deps.ghAvailable()) return report(deps, { state: 'gh-absent', pr: n }, audit);
  let localHead;
  try { localHead = String(deps.git(['rev-parse', 'HEAD'])).trim(); } catch (e) {
    return report(deps, { state: 'read-failed', pr: n, reason: `local HEAD unreadable: ${errText(e)}` }, audit);
  }
  return classifyPr(deps, n, localHead, audit);
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
