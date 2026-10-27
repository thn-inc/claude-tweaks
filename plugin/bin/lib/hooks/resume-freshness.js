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
const { runLiveness, blocksResume, resumeEntries } = require('../run-liveness');
const { DEFAULT_PROBES } = require('../run-liveness/probes');
const { LIVE_WINDOW_MS } = require('../run-liveness/constants');

// "On the order of minutes" (the spec's own phrasing): long enough that a
// burst of commits from a single working session's normal cadence doesn't
// read as a stranger, short enough that a genuinely dead run isn't gated for
// an unreasonable stretch. Not configurable via policy — this guards a
// safety decision, not a stylistic preference. The value is run-liveness's
// LIVE_WINDOW_MS by design (one window for "recent"), re-exported here under
// the name the call sites already use.
const RESUME_FRESHNESS_THRESHOLD_MS = LIVE_WINDOW_MS; // 10 minutes

// runDir: the pipeline run directory whose run-state.json to read.
// opts: { sessionId, now, probes } — all optional; sessionId should be the
// caller's own CLAUDE_CODE_SESSION_ID, now defaults below, and probes is merged
// over run-liveness's DEFAULT_PROBES by runLiveness (a test seam).
function checkResumeFreshness(runDir, opts = {}) {
  const sessionId = opts.sessionId || null;
  const now = typeof opts.now === 'number' ? opts.now : Date.now();

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

  // The worktree lock and last-commit answers come from run-liveness's
  // `worktree-lock` and `last-commit` evidence, read through `blocksResume`
  // (only those two probes can block a resume; the owner probes never do). An
  // unknown answer — an unknown lock, an unlisted worktree, a failed listing or
  // `git log`, an unparseable time — is an `error` entry, so it fails CLOSED
  // to `indeterminate` rather than reading as "not locked" / "quiet". The raw
  // commit time is captured through the probe wrapper because the evidence
  // entry carries only a verdict, and `recent-commit` reports `ageMs`.
  let commitAt = null;
  const lastCommitAt = (opts.probes && opts.probes.lastCommitAt) || DEFAULT_PROBES.lastCommitAt;
  const probes = { ...(opts.probes || {}), lastCommitAt: (wt) => (commitAt = lastCommitAt(wt)) };
  const result = runLiveness(runDir, { now, probes });
  const { lock, commit } = resumeEntries(result);
  if (lock.result === 'positive') return { safe: false, verdict: 'locked', reason: 'worktree lock held by a live process' };
  if (commit.result === 'positive') {
    return {
      safe: false,
      verdict: 'recent-commit',
      reason: `worktree committed to within the last ${Math.round(RESUME_FRESHNESS_THRESHOLD_MS / 60000)} minutes`,
      ageMs: now - commitAt,
    };
  }
  // Fail CLOSED: a run genuinely stamped `interrupted` whose activity we
  // cannot verify is not safe-by-default — see the Global Constraints
  // note in the plan this module was built from.
  if (blocksResume(result)) return { safe: false, verdict: 'indeterminate', reason: (lock.result !== 'negative' ? lock : commit).detail };
  // An empty log / unborn HEAD is "no evidence of quiet", not "quiet".
  if (commit.detail === 'no-commits') return { safe: false, verdict: 'indeterminate', reason: 'could not determine worktree activity' };

  return { safe: true, verdict: 'stale' };
}

module.exports = { checkResumeFreshness, RESUME_FRESHNESS_THRESHOLD_MS };
