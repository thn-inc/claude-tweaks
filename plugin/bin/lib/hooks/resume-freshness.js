// bin/lib/hooks/resume-freshness.js — the freshness probe a resume path runs
// before treating a run stamped `status: interrupted` as safe to re-enter.
//
// Why this exists: `status: interrupted` is a statement about one past
// session ("the session that owned this run ended"), never a statement that
// nobody owns the run *now*. On 2026-08-16, run 2026-08-16T174412 read
// `interrupted` while a *different* live session was actively committing to
// its shared worktree, and a resume attempt got as far as announcing entry
// before fresh commit timestamps — noticed incidentally, not gated —
// reversed the ruling. This module is the gate that should have caught it.
//
// Non-regression against the two-call dispatch handoff (#676's own risk
// analysis): `/claude-tweaks:dispatch` hands a group to `/flow` as TWO
// sequential Task-tool calls sharing one `PIPELINE_RUN_DIR` — the first
// (`build,test`) finishing and the second (`review,polish,wrap-up`) starting
// moments later, very likely under a *different* `CLAUDE_CODE_SESSION_ID`,
// with a commit from the first call still fresh on disk. That shape must
// never be blocked. It structurally cannot trip this probe: a Task-tool
// subagent's normal turn end fires `SubagentStop`, never `SessionEnd`
// (bin/lib/hooks/subagent-stop.js's own header states SubagentStop is what
// fires "for Task dispatches"), and `SessionEnd` is the only trigger that
// stamps `interrupted` (bin/lib/hooks/session-end.js). Between the two Task
// calls the top-level dispatching session never ends, so `run-state.json`
// stays `status: active` the whole time — this probe's very first
// status-gated check (below) reads `not-interrupted` and returns safe before
// ever looking at commit recency or lock state. Corroborated by
// `skills/wrap-up/SKILL.md`'s own "Resuming a halted Review Console"
// section: "A normal turn end is not a session end, so the hooks layer's
// interruption stamp... never runs, and run-state.json stays status: active".
'use strict';
const fs = require('fs');
const ctxLib = require('./context');
const { parseWorktreeList, lockVerdict } = require('./worktree-reap');
const { mainCheckoutRoot, safeReal } = require('./worktree-detect');
const { runGit } = require('./git-exec');

// "On the order of minutes" (the spec's own phrasing): long enough that a
// burst of commits from a single working session's normal cadence doesn't
// read as a stranger, short enough that a genuinely dead run isn't gated for
// an unreasonable stretch. Not configurable via policy — this guards a
// safety decision, not a stylistic preference, and the threshold plus its
// rationale living here (rather than scattered across call sites) is the
// point of having one shared probe.
const RESUME_FRESHNESS_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// runDir: the pipeline run directory whose run-state.json to read.
// opts: { sessionId, now, thresholdMs } — all optional; sessionId should be
// the caller's own CLAUDE_CODE_SESSION_ID, now/thresholdMs default below.
function checkResumeFreshness(runDir, opts = {}) {
  const sessionId = opts.sessionId || null;
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const thresholdMs = typeof opts.thresholdMs === 'number' ? opts.thresholdMs : RESUME_FRESHNESS_THRESHOLD_MS;

  const state = ctxLib.readRunState(runDir);
  if (!state) return { safe: true, verdict: 'no-state' };

  // Identity check FIRST, per the spec's own Gotchas: a session restart
  // re-stamps ownership via `record-worktree`, and that continuing session
  // must never be blocked from its own run.
  if (sessionId && state.sessionId && state.sessionId === sessionId) {
    return { safe: true, verdict: 'own-session' };
  }

  // The whole probe is scoped to the `interrupted` stamp specifically — see
  // this file's header comment for why that is what makes the two-call
  // dispatch handoff provably safe rather than merely assumed safe.
  if (state.status !== 'interrupted') {
    return { safe: true, verdict: 'not-interrupted' };
  }

  const worktree = typeof state.worktree === 'string' ? state.worktree : null;
  if (!worktree) return { safe: true, verdict: 'no-worktree' };
  if (!fs.existsSync(worktree)) return { safe: true, verdict: 'worktree-gone' };

  // (b) worktree lock-file pid liveness. Resolve the lock verdict directly
  // (rather than through isWorktreeLocked's collapsed boolean) so an
  // unresolvable root or a failed `git worktree list` reads as
  // `indeterminate` rather than being reported to a human as a confirmed
  // live lock — see #676's final review, Important finding #1.
  const wtRoot = mainCheckoutRoot(worktree);
  if (!wtRoot) {
    return { safe: false, verdict: 'indeterminate', reason: 'could not resolve the recorded worktree\'s main checkout to check its lock state' };
  }
  const { stdout: wtListOut, failure: wtListFailure } = runGit(['worktree', 'list', '--porcelain'], wtRoot);
  if (wtListFailure) {
    return { safe: false, verdict: 'indeterminate', reason: 'could not list worktrees to check lock state' };
  }
  const target = safeReal(worktree) || worktree;
  const entry = parseWorktreeList(wtListOut).find(
    (e) => (safeReal(e.path) || e.path) === target || e.path === worktree
  );
  if (entry && lockVerdict(entry) === 'in-use') {
    return { safe: false, verdict: 'locked', reason: 'worktree lock held by a live process' };
  }

  // (a) last-commit age in the run's recorded worktree.
  const { stdout, failure } = runGit(['log', '-1', '--format=%ct'], worktree);
  if (failure || !stdout) {
    // Fail CLOSED: a run genuinely stamped `interrupted` whose activity we
    // cannot verify is not safe-by-default — see the Global Constraints
    // note in the plan this module was built from.
    return { safe: false, verdict: 'indeterminate', reason: 'could not determine worktree activity' };
  }
  const commitMs = Number(stdout) * 1000;
  if (!Number.isFinite(commitMs)) {
    return { safe: false, verdict: 'indeterminate', reason: 'could not parse last-commit timestamp' };
  }
  const ageMs = now - commitMs;
  if (ageMs < thresholdMs) {
    return {
      safe: false,
      verdict: 'recent-commit',
      reason: `worktree committed to within the last ${Math.round(thresholdMs / 60000)} minutes`,
      ageMs,
    };
  }

  return { safe: true, verdict: 'stale' };
}

module.exports = { checkResumeFreshness, RESUME_FRESHNESS_THRESHOLD_MS };
