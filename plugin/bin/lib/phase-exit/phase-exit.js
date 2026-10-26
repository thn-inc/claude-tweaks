// The whole pr-first phase exit as one call (#4026), behind bin/phase-exit.js.
// It replaces the agent-run sequence _shared/git-discipline.md's Phase exit
// section, build/SKILL.md Common Step 7's Bookkeeping assertion and
// _shared/pr-checklist-refresh.md's Phase-checklist update used to spell out,
// and keeps each guard that prose left to the reader as its own branch:
//
//   1. Route. `git rev-parse --git-dir --git-common-dir` equal -> current-branch
//      (no worktree branch: no bookkeeping, no push). Else integration-model via
//      resolve-policy.js --run: local-merge -> no push, no gh; pr-first -> on.
//      Either skip writes git-discipline.md's SKIP line at build only.
//      An unresolvable model pushes nothing and writes one SKIP degrade trace.
//   2. Branch guard (pr-first). A detached HEAD or the integration branch
//      (integration-branch policy, else origin/HEAD, else main) is refused: no
//      push, no merge-state read; the commit check and the checklist still run.
//      So is a --worktree whose real path is not an active run's recorded
//      `worktree` -- the check hooks/pre-tool-use.js's E1 loop makes for a Bash
//      push -- which also appends E1's `wd-push-mismatch` event.
//   3. Commit check. Uncommitted paths are logged and the push goes ahead.
//   4. Bookkeeping, in worktree mode under either model: a run-state with no
//      `worktree` runs `hooks.js record-worktree`; under pr-first, one with no
//      `pr` (and no prExempt) looks up the branch's one open PR and runs
//      `hooks.js record-pr`. Only a backfill that ran writes a line. A closed
//      run (wrap-up after cleanup item 8's close-run, archived or not) is never
//      written: both report n/a. Opening a missing PR stays the caller's
//      (_shared/pr-early-run-lifecycle.md).
//   5. Push, under GIT_PUSH_TIMEOUT_MS (the consumer's pre-push hook runs
//      inside it). Still no recorded PR after step 4 -> the push is skipped unless
//      one of hooks/pre-tool-use.js checkBookkeepingStampsGate's PR-stamp release
//      conditions holds ([IL-131]): prExempt, a closed run, a logged `PR-early run
//      lifecycle: … FAILED` line, or a first-publish push whose Step 1 line is
//      logged. A push from this process is invisible to that PreToolUse gate, so
//      the gate's rule is applied here. A failed push is logged and never written
//      to run-state.json; the next phase exit's push retries. A landed push on a
//      run that is not closed appends the same `{type:'commit', action:'push',
//      dir, hash}` events.jsonl line hooks/post-tool-use.js writes for a Bash
//      `git push` (through the same context.js appendEvent, deduped the same
//      way): lib/timing/derive.js starts the merge phase at the first push after
//      wrap-up starts.
//   6. Checklist: bin/pr-checklist.js in-process, every pr-first route that got
//      past step 1. Its exit 4/5 lines are its own.
//   7. Merge state: bin/pr-merge-state.js in-process, only after a push landed.
//      Its lines are its own.
//
// This module writes decisions.md only through lib/log-decision/append.js,
// events.jsonl only through hooks/context.js's appendEvent, and run-state.json
// only through hooks.js verbs. A failed append never changes an outcome: it
// lands in `logFailures` (kind `decision` with the entry's status/step/text, so
// the caller can hand-log it; kind `event` with the event) plus one stderr line.
// The real appendEvent is best-effort and swallows its own write errors, so only
// a seam that throws reaches `logFailures` as an `event` failure.
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const { formatEntry, appendEntry } = require('../log-decision/append');
const { readRunStateWithParent, appendEvent, readEventLines } = require('../hooks/context');
const { hasLoggedPrDegrade, hasLoggedPrEarlyStep1, hasNoUpstreamYet } = require('../hooks/pre-tool-use');
const { GH_TIMEOUT_MS, GIT_TIMEOUT_MS, GIT_PUSH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES, isTimeoutError } = require('../shared-primitives');
const { canonicalRealpath } = require('../path-guard');
const prChecklist = require('../../pr-checklist');
const prMergeState = require('../../pr-merge-state');

const { PHASE_SECTIONS } = prMergeState;
const BIN = path.resolve(__dirname, '..', '..');
const RESOLVE_POLICY_JS = path.join(BIN, 'resolve-policy.js');
const HOOKS_JS = path.join(BIN, 'hooks.js');

// The Common Step 7 phase-exit push SKIP text callers hand-logged before #4026 (this
// module is now its only home; git-discipline.md's Phase exit section names the SKIP only).
const SKIP_TEXT = 'condition: integration-model=local-merge or current-branch mode → fallback: no phase-exit push, one push at finish';

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  // maxBuffer: the push runs the consumer's pre-push hook with its output piped here; under
  // execFileSync's 1 MiB default a chatty hook is killed with ENOBUFS (SIGTERM), which
  // isTimeoutError would then report as a timeout.
  git: (args, { timeout = GIT_TIMEOUT_MS } = {}) => execFileSync('git', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, windowsHide: true, maxBuffer: LARGE_MAX_BUFFER_BYTES,
  }),
  gh: (args, cwd) => execFileSync('gh', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true,
  }),
  resolvePolicy: (runDir, key, cwd) => execFileSync(process.execPath, [RESOLVE_POLICY_JS, '--run', runDir, '--values', key], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, windowsHide: true,
  }).split('\n')[0].trim(),
  hooks: (args, cwd) => execFileSync(process.execPath, [HOOKS_JS, ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, windowsHide: true,
  }),
  prChecklistRun: (argv, deps) => prChecklist.run(argv, deps),
  prMergeStateRun: (argv, deps) => prMergeState.run(argv, deps),
  appendDecision: (args) => appendEntry(args),
  appendEvent: (runDir, type, data) => appendEvent(runDir, type, data),
  readEventLines: (runDir) => readEventLines(runDir),
  hasNoUpstreamYet: (dir) => hasNoUpstreamYet(dir),
  readRunState: (runDir) => readRunStateWithParent(runDir, { requireRunIdParent: true }).state,
  now: () => new Date(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function firstLine(v) {
  return String(v == null ? '' : v).split('\n').map((l) => l.trim()).find(Boolean) || '';
}

function errLine(e) {
  return firstLine(e && e.stderr) || firstLine(e && e.message) || firstLine(e);
}

// `.claude-tweaks/pipelines/archive/{run-id}[/spec-N]` -- cleanup item 8's archive path.
function isArchivedRun(runDir) {
  const abs = path.resolve(runDir);
  const runIdDir = /^spec-/.test(path.basename(abs)) ? path.dirname(abs) : abs;
  const archive = path.dirname(runIdDir);
  return path.basename(archive) === 'archive' && path.basename(path.dirname(archive)) === 'pipelines';
}

// `git status --porcelain -z` records -> the paths they name. A rename or copy
// carries its source path as the next NUL-separated record, skipped here.
function parsePorcelainZ(out) {
  const recs = String(out || '').split('\0');
  const paths = [];
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (rec.length < 4) continue;
    paths.push(rec.slice(3));
    if (rec[0] === 'R' || rec[0] === 'C') i++;
  }
  return paths;
}

class InvalidWorktreeError extends Error {}

// opts: { run, phase, worktree, fixes?, remove?, summaryFile? } -- already validated by
// the CLI wrapper (phase is a PHASE_SECTIONS key; run resolved and anchored).
// Throws InvalidWorktreeError when --worktree is not a git checkout; otherwise returns
// the envelope and never throws on a seam failure.
function runPhaseExit(opts, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const { run: runDir, phase } = opts;
  const wt = opts.worktree;
  const section = PHASE_SECTIONS[phase];
  const env = {
    phase, route: null, branch: null, head: null, commit: null, bookkeeping: null,
    push: null, checklist: null, mergeState: null, logFailures: [],
  };

  const log = (status, step, text, reversibility = 'n/a') => {
    try {
      const entry = formatEntry({ status, now: deps.now(), step, text, reversibility });
      deps.appendDecision({ runDir, section, entry });
    } catch (e) {
      const error = (e && e.message) || String(e);
      env.logFailures.push({ kind: 'decision', status, step, text, error });
      deps.stderr(`phase-exit.js: could not append the decisions.md entry (${step}): ${error}\n`);
    }
  };
  const tryGit = (args) => { try { return deps.git(args); } catch { return null; } };

  // 1. Route. The checkout probe doubles as --worktree validation.
  let dirs;
  try { dirs = deps.git(['-C', wt, 'rev-parse', '--git-dir', '--git-common-dir']); } catch (e) {
    throw new InvalidWorktreeError(`--worktree is not a git checkout: ${wt} (${errLine(e)})`);
  }
  const [gitDir, commonDir] = String(dirs).split('\n').map((l) => l.trim()).filter(Boolean);
  if (!gitDir || !commonDir) throw new InvalidWorktreeError(`--worktree is not a git checkout: ${wt} (rev-parse printed no git dir)`);
  env.branch = firstLine(tryGit(['-C', wt, 'branch', '--show-current'])) || null;
  env.head = firstLine(tryGit(['-C', wt, 'rev-parse', 'HEAD'])) || null;

  if (path.resolve(wt, gitDir) === path.resolve(wt, commonDir)) {
    env.route = 'current-branch';
    env.bookkeeping = { worktree: 'n/a', pr: 'n/a' };
    env.push = { state: 'skipped', reason: 'current-branch mode' };
    if (phase === 'build') log('SKIP', 'Common Step 7 phase-exit push (skipped)', SKIP_TEXT);
    return env;
  }

  let model; let modelDetail;
  try { model = deps.resolvePolicy(runDir, 'integration-model', wt); } catch (e) { modelDetail = errLine(e) || 'resolve-policy.js failed'; }
  if (modelDetail === undefined && model !== 'pr-first' && model !== 'local-merge') {
    modelDetail = model ? `unexpected value ${JSON.stringify(model)}` : 'empty value';
  }
  if (modelDetail !== undefined) {
    env.push = { state: 'skipped', reason: `integration-model unresolved (${modelDetail})` };
    log('SKIP', 'Phase-exit push', `condition: integration-model unresolved (${modelDetail}) → fallback: no phase-exit push this phase; the next phase exit retries`);
    return env;
  }
  env.route = model;

  let state = null;
  try { state = deps.readRunState(runDir); } catch { state = null; }
  const closed = isClosedRun(state, runDir);

  if (model === 'local-merge') {
    env.bookkeeping = bookkeeping({ deps, runDir, wt, phase, state, closed, log, prFirst: false, branch: null });
    env.push = { state: 'skipped', reason: 'integration-model=local-merge' };
    if (phase === 'build') log('SKIP', 'Common Step 7 phase-exit push (skipped)', SKIP_TEXT);
    return env;
  }

  // 2. Branch guard.
  const integration = resolveIntegrationBranch(deps, runDir, wt);
  const runBranch = env.branch && env.branch !== integration ? env.branch : null;
  if (!runBranch) {
    const label = env.branch || 'detached HEAD';
    env.push = { state: 'refused', reason: `${label} is not a run branch` };
    log('AUTO', 'Phase-exit push', `refused to push ${label} at ${phase} exit — not a run branch`);
  } else if (!closed && hasWorktree(state)) {
    // The run's assigned worktree vs --worktree -- the check hooks/pre-tool-use.js's E1
    // loop makes for a Bash push, which never sees this process's push. Fails open on an
    // unprovable path, as that loop does ("cannot prove the target -> allow", pre-tool-use.js).
    const expected = canonicalRealpath(state.worktree);
    const actual = canonicalRealpath(wt);
    if (expected && actual && expected !== actual) {
      const reason = `--worktree ${actual} is not the run's worktree ${expected}`;
      env.push = { state: 'refused', reason };
      appendRunEvent(deps, runDir, env, 'wd-push-mismatch', { expected, actual, command: `git -C ${wt} push origin ${runBranch}`.slice(0, 200) }, 'wd-push-mismatch event');
      log('AUTO', 'Phase-exit push', `refused to push ${runBranch} at ${phase} exit — ${reason}`);
    }
  }
  const pushBranch = env.push ? null : runBranch;

  // 3. Commit check -- also on a refused branch, so a dirty tree still leaves its trace.
  try {
    const dirty = parsePorcelainZ(deps.git(['-C', wt, '--no-optional-locks', 'status', '--porcelain', '-z']));
    env.commit = { clean: dirty.length === 0, dirty };
    if (dirty.length) log('AUTO', 'Phase-exit push', `${dirty.length} uncommitted path(s) at ${phase} exit not included in the push`);
  } catch (e) {
    env.commit = { clean: null, dirty: [], error: errLine(e) };
  }

  // 4. Bookkeeping.
  env.bookkeeping = bookkeeping({ deps, runDir, wt, phase, state, closed, log, prFirst: true, branch: runBranch });

  // 5. Push.
  if (pushBranch && !prPushReleased(deps, runDir, wt, pushBranch, state, env.bookkeeping)) {
    env.push = { state: 'skipped', reason: 'no recorded PR — open it first (pr-early-run-lifecycle)' };
    log('SKIP', 'Phase-exit push', `condition: no recorded PR for ${pushBranch} and no PR-early run lifecycle FAILED line → fallback: no phase-exit push this phase; open the PR first (_shared/pr-early-run-lifecycle.md)`);
  } else if (pushBranch) {
    const timeout = GIT_PUSH_TIMEOUT_MS;
    try {
      deps.git(['-C', wt, 'push', 'origin', pushBranch], { timeout });
      env.push = { state: 'pushed' };
    } catch (e) {
      const reason = isTimeoutError(e) ? `timed out after ${timeout} ms` : (errLine(e) || 'git push failed');
      env.push = { state: 'failed', reason };
      log('AUTO', 'Phase-exit push', `push of ${pushBranch} to origin FAILED at ${phase} exit (${reason}); the next phase exit's push retries`);
    }
    if (env.push.state === 'pushed' && !closed) recordPushEvent(deps, runDir, wt, env);
  }

  // 6. Checklist.
  env.checklist = runSub(deps, deps.prChecklistRun, ['--run', runDir, '--phase', phase, ...checklistFlags(opts)]);

  // 7. Merge state.
  if (env.push.state === 'pushed') {
    env.mergeState = runSub(deps, deps.prMergeStateRun, ['--run', runDir, '--phase', phase]);
  }
  return env;
}

// The flags phase-exit forwards to bin/pr-checklist.js unchanged.
function checklistFlags({ remove, fixes, summaryFile }) {
  const flags = [];
  if (remove) flags.push('--remove');
  if (fixes) flags.push('--fixes', fixes);
  if (summaryFile) flags.push('--summary-file', summaryFile);
  return flags;
}

// Whether a pr-first push may go ahead with no recorded PR. Mirrors
// hooks/pre-tool-use.js checkBookkeepingStampsGate's PR-stamp branch ([IL-131]),
// through that file's own predicates: a recorded PR (pr present or backfilled),
// prExempt, a logged `PR-early run lifecycle: … FAILED` line (on the run dir or,
// as lib/pr-bookkeeping/precondition.js also reads it, a per-spec dir's parent),
// or the #989/#1800 first-publish release -- the branch has no upstream of its
// own yet and this branch's Step 1 line is logged. A closed run (status clean) is
// released outright, as that gate returns early on one.
function prPushReleased(deps, runDir, wt, branch, state, bookkeepingResult) {
  if (bookkeepingResult.pr === 'present' || bookkeepingResult.pr === 'backfilled') return true;
  if (state && (state.prExempt || state.status === 'clean' || hasPr(state))) return true;
  const absRunDir = path.resolve(runDir);
  const dirs = [runDir];
  if (/^spec-/.test(path.basename(absRunDir))) dirs.push(path.dirname(absRunDir));
  if (dirs.some((d) => hasLoggedPrDegrade(d))) return true;
  let noUpstream = false;
  try { noUpstream = deps.hasNoUpstreamYet(wt) === true; } catch { noUpstream = false; }
  return noUpstream && hasLoggedPrEarlyStep1(runDir, branch);
}

// The push breadcrumb hooks/post-tool-use.js writes for a Bash `git push`: same type,
// fields and (action, hash, dir) dedupe against the run's prior commit-typed events.
// `hash` is the abbreviated HEAD, as the hook's `git log --format=%h` read gives it.
function recordPushEvent(deps, runDir, wt, env) {
  let short = null;
  try { short = firstLine(deps.git(['-C', wt, 'rev-parse', '--short', 'HEAD'])) || null; } catch { short = null; }
  const data = { action: 'push', dir: path.resolve(wt), hash: short || undefined };
  appendRunEvent(deps, runDir, env, 'commit', data, 'push breadcrumb', () => {
    if (!data.hash) return false;
    const prior = deps.readEventLines(runDir) || [];
    return prior.some((ev) => ev && ev.type === 'commit' && ev.action === 'push' && ev.hash === data.hash && ev.dir === data.dir);
  });
}

// One events.jsonl line through context.js appendEvent, unless `isDuplicate()` says
// it is already there; a throw from either lands in logFailures plus one stderr line.
function appendRunEvent(deps, runDir, env, type, data, what, isDuplicate = () => false) {
  try {
    if (isDuplicate()) return;
    deps.appendEvent(runDir, type, data);
  } catch (e) {
    const error = (e && e.message) || String(e);
    env.logFailures.push({ kind: 'event', type, data, error });
    deps.stderr(`phase-exit.js: could not append the events.jsonl ${what}: ${error}\n`);
  }
}

// integration-branch policy, else origin/HEAD minus `origin/`, else main.
function resolveIntegrationBranch(deps, runDir, wt) {
  let name = '';
  try { name = firstLine(deps.resolvePolicy(runDir, 'integration-branch', wt)); } catch { name = ''; }
  if (name) return name;
  try {
    name = firstLine(deps.git(['-C', wt, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])).replace(/^origin\//, '');
  } catch { name = ''; }
  return name || 'main';
}

// A sibling CLI run in-process with its stdout captured; its last stdout line is its JSON.
// Returns the envelope entry: { exit, ...its JSON envelope, error? }.
function runSub(deps, fn, argv) {
  const out = [];
  let exit;
  try {
    exit = fn(argv, { cwd: deps.cwd, mainRoot: deps.mainRoot, stdout: (s) => out.push(s), stderr: (s) => deps.stderr(s) });
  } catch (e) {
    return { exit: null, error: errLine(e) || 'threw' };
  }
  let parsed = null;
  const last = out.join('').trim().split('\n').pop();
  try { parsed = last ? JSON.parse(last) : null; } catch { parsed = null; }
  if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) parsed = null;
  return { exit, ...parsed };
}

const hasWorktree = (s) => Boolean(s && typeof s.worktree === 'string' && s.worktree);
const hasPr = (s) => Boolean(s && s.pr && Number.isInteger(s.pr.number) && s.pr.number > 0);

function runHook(deps, args, wt) {
  try { return { out: String(deps.hooks(args, wt) || '') }; } catch (e) {
    return { out: String((e && e.stdout) || ''), error: errLine(e) };
  }
}

// A run cleanup item 8 already closed: close-run's write (status clean, worktree null,
// worktreeAtClose), or the run dir archive-run moved under archive/. Terminal, so it is
// never written again -- a record-worktree here would write status active back and
// re-arm E1 -- and gets no events.jsonl line (wrap-up/cleanup-procedures-execution.md:
// E2/E3 logging stops at close-run).
function isClosedRun(state, runDir) {
  if (state && (state.status === 'clean' || (typeof state.worktreeAtClose === 'string' && state.worktreeAtClose))) return true;
  return isArchivedRun(runDir);
}

function bookkeeping({ deps, runDir, wt, phase, state, closed, log, prFirst, branch }) {
  if (closed) return { worktree: 'n/a', pr: 'n/a' };
  const step = phase === 'build' ? 'Common Step 7 bookkeeping assertion' : 'Phase-exit bookkeeping assertion';
  const result = { worktree: null, pr: null };
  const details = [];

  if (hasWorktree(state)) {
    result.worktree = 'present';
  } else {
    const r = runHook(deps, ['record-worktree', '--run', runDir, path.resolve(wt)], wt);
    if (r.out.includes('worktree recorded for ')) {
      result.worktree = 'backfilled';
      log('AUTO', step, 'backfilled worktree registration before phase-exit push', 'high');
    } else {
      result.worktree = 'failed';
      details.push(`record-worktree did not record the worktree: ${firstLine(r.out) || r.error || 'no output'}`);
    }
  }

  if (!prFirst || (!hasPr(state) && state && state.prExempt)) {
    result.pr = 'n/a';
  } else if (hasPr(state)) {
    result.pr = 'present';
  } else if (!branch) {
    result.pr = 'missing';
    details.push('no run branch to look up an open PR for');
  } else {
    backfillPr({ deps, runDir, wt, branch, step, log, result, details });
  }

  if (details.length) result.detail = details.join('; ');
  return result;
}

function backfillPr({ deps, runDir, wt, branch, step, log, result, details }) {
  let list;
  try {
    list = JSON.parse(deps.gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url'], wt));
    if (!Array.isArray(list)) throw new Error('not a list');
  } catch (e) {
    result.pr = 'failed';
    details.push(`gh pr list failed: ${errLine(e)}`);
    return;
  }
  if (list.length === 0) {
    result.pr = 'missing';
    details.push(`no open PR for ${branch}`);
    return;
  }
  if (list.length > 1) {
    result.pr = 'failed';
    details.push(`${list.length} open PRs for ${branch} — not recorded`);
    return;
  }
  const { number, url } = list[0] || {};
  if (!Number.isInteger(number) || number <= 0 || typeof url !== 'string' || !url) {
    result.pr = 'failed';
    details.push('gh pr list returned an unusable PR entry');
    return;
  }
  const r = runHook(deps, ['record-pr', '--run', runDir, String(number), url], wt);
  if (r.out.includes(`PR #${number} recorded for `)) {
    result.pr = 'backfilled';
    details.push(`recorded open PR #${number}`);
    // build/SKILL.md Common Step 7's `{worktree registration | PR-early lifecycle}` text, verbatim.
    log('AUTO', step, 'backfilled PR-early lifecycle before phase-exit push', 'high');
  } else {
    result.pr = 'failed';
    details.push(`record-pr did not record PR #${number}: ${firstLine(r.out) || r.error || 'no output'}`);
  }
}

module.exports = { runPhaseExit, realDeps, checklistFlags, parsePorcelainZ, isArchivedRun, InvalidWorktreeError, PHASE_SECTIONS };
