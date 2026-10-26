// bin/lib/hooks/git-exec.js — the one execFileSync('git', ...) spawn wrapper
// shared by every hooks/ module that needs to ask git a question (
// worktree-detect.js, pre-tool-use.js, post-tool-use.js). Previously
// hand-copied verbatim in each of those files; a fix to the shared contract
// now only needs to land once instead of being hunted down in every copy.
'use strict';
const { runClassified, runClassifiedAsync } = require('../shared-primitives');
// #4032: both spawns below go through the timed twins, which record into
// reconcile()'s timing store when one is active (a no-op otherwise: hook paths
// that never reconcile pay two clock reads). They resolve `cp.execFileSync` /
// `promisify(cp.execFile)` by property access at call time — never a snapshotted
// binding — so a test's `t.mock.method(cp, 'execFileSync', ...)` or
// `cp.execFile = stub` still reaches them (#381, #872 follow-up); see timing.js.
const { execFileSyncTimed, execFileAsyncTimed } = require('../reconcile/timing');

// Budget for one git query, sized from measurement rather than intuition (#134).
//
// The previous value was 3000ms. Measuring the enforcement-critical call
// (worktree-detect's four-flag `rev-parse`) against real machine load showed
// that budget has no headroom on a repo whose normal working mode is several
// parallel worktree sessions — maximum observed duration was 411ms idle,
// 752ms under one competing test suite, 1856ms under three, and 2492ms under
// 24 workers plus two suites: 83% of the old budget. The timeout demonstrably
// fired in practice.
//
// 10000ms is ~4x the worst duration observed at peak contention. It is a
// CEILING, not a cost — the normal case is ~45ms, and the ceiling only binds
// when git is already pathologically slow. In that situation the alternative
// to waiting is worse than waiting: a timeout here resolves to "cannot
// determine", and pre-tool-use's worktree gate then allows a write it would
// otherwise have denied, silently disabling a policy the user opted into.
const DEFAULT_TIMEOUT_MS = 10000;

// Test-only escape hatch: sibling `npm test` runs contending for the same
// machine can push a plain `git init`/`rev-parse` on a fresh temp repo past
// even this budget (#104 measured 12.1s), which reads as a false
// `indeterminate` verdict to test code that expects a definitive answer.
// Raising DEFAULT_TIMEOUT_MS itself would weaken production's safety net
// (see the comment above) for every real hook invocation, not just tests, so
// the override is opt-in via env var — unset in every real Claude Code
// session, set only by the `test` npm script (package.json).
function resolveTimeout(opts) {
  if (opts.timeoutMs != null) return opts.timeoutMs;
  const override = Number(process.env.CT_HOOKS_GIT_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) return override;
  return DEFAULT_TIMEOUT_MS;
}

// Failure kinds. Only `git-error` is a real ANSWER from git (it ran and exited
// non-zero — e.g. "not a git repository"); every other kind means the question
// was never answered at all. A caller making a policy decision must tell these
// apart: treating "I could not ask" as "the answer is no" is exactly the
// conflation that let the worktree gate stop enforcing under load (#134).
const FAILURE = {
  TIMEOUT: 'timeout',       // budget blown — indeterminate
  SPAWN: 'spawn',           // OS refused the fork (EAGAIN/ENOMEM/...) — indeterminate
  NO_GIT: 'no-git',         // git not installed / not on PATH — indeterminate
  GIT_ERROR: 'git-error',   // git ran and exited non-zero — a definitive answer
};

const INDETERMINATE = new Set([FAILURE.TIMEOUT, FAILURE.SPAWN, FAILURE.NO_GIT]);

// True when `failure` means the question went unanswered, rather than answered
// in the negative. `null` (success) is not indeterminate.
function isIndeterminate(failure) {
  return INDETERMINATE.has(failure);
}

function classify(err) {
  // execFileSync signals a timeout kill via `killed`/`signal` and, depending on
  // platform and Node version, an ETIMEDOUT code — check all three rather than
  // relying on any one being present.
  if (err.code === 'ETIMEDOUT' || err.killed === true || err.signal === 'SIGTERM') return FAILURE.TIMEOUT;
  if (err.code === 'EAGAIN' || err.code === 'ENOMEM' || err.code === 'EMFILE' || err.code === 'ENFILE') {
    return FAILURE.SPAWN;
  }
  if (err.code === 'ENOENT') return FAILURE.NO_GIT;
  return FAILURE.GIT_ERROR;
}

// Shared by both runGit and runGitAsync below — defined once so a future
// fix to the success/failure shape (e.g. the #1341 stderr addition) cannot
// land on one twin without the other picking it up automatically (#1652).
function buildSuccess(stdout, raw) {
  return { stdout: raw ? stdout : stdout.trim(), failure: null, stderr: null };
}

function buildFailure(err) {
  // execFileSync/execFile populate err.stderr as a string when `encoding` is
  // set (as it is below), same as they populate err.stdout on success. A
  // timeout kill or a spawn failure (EAGAIN/ENOENT/...) may never have
  // produced any stderr at all — fall back to '' rather than surfacing
  // `undefined` through a field every caller now expects to be
  // string-or-null.
  const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : '';
  // #3023: additive, like #1341's stderr — a removal that fails with no stderr
  // text still has an exit status (and sometimes stdout) a caller can report.
  // execFileSync puts the exit status on `err.status`; execFile (the async
  // twin) puts it on `err.code`, which is a string for a spawn error instead.
  let exitCode = null;
  if (typeof err.status === 'number') exitCode = err.status;
  else if (typeof err.code === 'number') exitCode = err.code;
  const failureStdout = typeof err.stdout === 'string' ? err.stdout.trim() : '';
  return { stdout: null, failure: classify(err), stderr, exitCode, failureStdout };
}

// Runs `git -C <cwd> <args>`.
//
// Returns { stdout, failure, stderr } (plus exitCode/failureStdout on failure):
//   - success -> { stdout: '<trimmed stdout>', failure: null, stderr: null }
//   - failure -> { stdout: null, failure: one of FAILURE.*, stderr: '<trimmed
//     stderr text, or '' when git produced none>', exitCode: <git's exit
//     status as a number, or null when git never exited (timeout, spawn)>,
//     failureStdout: '<trimmed stdout git wrote before failing, or ''>' }
//
// `stderr` is additive (#1341) — every existing call site destructures only
// `{ stdout }`/`{ failure }`/both, so a new third field changes nothing for
// them. It does NOT change the FAILURE.* category any caller switches on or
// `isIndeterminate`'s verdict — those stay exactly the coarse classification
// they were; `stderr` is strictly extra diagnostic detail for a consumer
// (e.g. reap-merged.js's residue escalation) that wants git's real message
// instead of just the category name.
//
// Always an object, never null. The function is deliberately no longer named
// `execGit`: the old name returned `string | null`, so a call site left
// un-migrated would keep parsing and read the always-truthy result object as
// success — failing in the dangerous direction, silently (the hazard `[IL-31]`
// records). A rename turns every missed call site into a ReferenceError.
//
// opts.timeoutMs overrides the budget; tests use it to force the timeout branch
// deterministically. Production callers omit it.
//
// opts.env, when set, is the spawn's environment; when absent the child inherits
// process.env as before. An object is used as given, so `{}` is an empty
// environment (no PATH), not "unset". Pass repoPinnedEnv() to keep `-C <cwd>` in
// charge of which repo git operates on.
//
// opts.raw === true returns success `stdout` verbatim instead of trimmed (#3900).
// A `-z` reader passes it: trimming strips the leading space of a NUL stream's
// first path (" lead.txt" -> "lead.txt"), which then names a file that does not
// exist. Any other value keeps the trim; the failure shape is unchanged.
function runGit(args, cwd, opts = {}) {
  const timeout = resolveTimeout(opts);
  return runClassified(
    () => buildSuccess(execFileSyncTimed('git', ['-C', cwd, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout,
      ...(opts.env ? { env: opts.env } : {}),
      // Node defaults windowsHide to FALSE, which hands a child console
      // process a console of its OWN whenever the parent has none to
      // inherit. session-start.js's `reconcile-background` child is exactly
      // that case (`detached: true`), so without this flag every git query
      // the background pass makes flashes its own black console window on
      // Windows — one per invocation, for the whole pass, which reads to the
      // user as a runaway loop rather than routine janitorial work. Inert on
      // POSIX, where the option is ignored.
      windowsHide: true,
    }), opts.raw === true),
    buildFailure,
  );
}

// Async twin of runGit — a real (non-blocking) execFile, so a caller can run
// this concurrently with sibling async work instead of blocking the event
// loop (reconcile/index.js's FAST_CHECKS Promise.all, #872). Same contract
// as runGit (identical return shape via the shared buildSuccess/buildFailure
// above), just non-blocking — mirrors the execFile-based async pattern
// reconcile/pr-state.js's resolvePrStateAsync already established for `gh`
// calls, applied here to `git`.
//
// promisify(cp.execFile) is resolved fresh inside this function body, not
// hoisted to module scope — promisify captures its argument by reference at
// the point it's called, so hoisting would silently defeat a test's
// `cp.execFile = stub` monkeypatch (#872 follow-up — exactly this hoisted
// form shipped once and broke runGitAsync's own timeout test's ability to
// mock a slow child deterministically).
async function runGitAsync(args, cwd, opts = {}) {
  const timeout = resolveTimeout(opts);
  return runClassifiedAsync(
    async () => {
      const { stdout } = await execFileAsyncTimed('git', ['-C', cwd, ...args], {
        encoding: 'utf8', timeout, windowsHide: true,
        ...(opts.env ? { env: opts.env } : {}),
      });
      return buildSuccess(stdout, opts.raw === true);
    },
    buildFailure,
  );
}

// A copy of `env` without the four repo-locating variables. An inherited GIT_DIR
// (or GIT_WORK_TREE / GIT_INDEX_FILE / GIT_COMMON_DIR) overrides `git -C <dir>`'s
// repo discovery, so a child spawned from a linked worktree's session would
// commit onto that worktree's branch instead of the repo `-C` names (#4178).
// The list deliberately matches staged-patch/stack-check.js's gitEnv (the four
// variables); git's own `git rev-parse --local-env-vars` list is wider
// (GIT_OBJECT_DIRECTORY, GIT_ALTERNATE_OBJECT_DIRECTORIES, GIT_SHALLOW_FILE, ...),
// and widening it is a separate decision.
function repoPinnedEnv(env = process.env) {
  const out = { ...env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete out[k];
  return out;
}

// origin remote URL -> 'owner/repo' slug, or null when unparseable/absent.
// Moved here from reconcile/release-merged.js (#1082) — pr-state.js is a
// second consumer, and a third copy of this parse is how drift starts.
function repoSlugOf(repoRoot) {
  const remote = runGit(['remote', 'get-url', 'origin'], repoRoot);
  if (remote.failure || !remote.stdout) return null;
  const m = /[:/]([^/]+\/[^/]+?)(\.git)?$/.exec(remote.stdout);
  return m ? m[1] : null;
}

module.exports = { runGit, runGitAsync, isIndeterminate, FAILURE, DEFAULT_TIMEOUT_MS, repoSlugOf, repoPinnedEnv };
