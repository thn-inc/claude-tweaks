// The dispatch-call discriminator (#3711): decides whether the current call is one of
// /claude-tweaks:dispatch's Task calls, for wrap-up/auto-merge-short-circuit.md's Dispatch-call
// branch. Two writers stamp run-state.json, both via `hooks.js record-worktree`: every call
// stamps `sessionId` (CLAUDE_CODE_SESSION_ID), and the `--dispatch` flag additionally stamps a
// permanent `dispatched: true`. A Task subagent shares its dispatching session's id, and the
// dispatched call re-runs record-worktree at build Common Step 1 Step 4.5, so a Task call sees
// `dispatched: true` AND a stamped `sessionId` equal to its own.
//
// The per-run `dispatched` marker alone is not enough: it is permanent for the run's lifetime, so
// a human running /flow on a run that dispatch once touched — or a human resuming a dispatched run
// in a new session — would read as a Task call and skip the direct-merge path. The session match
// is what separates them; an absent or empty id on either side never matches (`'' === ''` and
// `undefined === undefined` must not count), and nothing here throws — a missing or unreadable
// run-state.json is a genuine human-run session (false), which falls through to the direct-merge
// path.
'use strict';

const { readRunState } = require('../hooks/context');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isDispatchTaskCall({ runState, sessionId } = {}) {
  if (!runState || typeof runState !== 'object' || Array.isArray(runState)) return false;
  if (runState.dispatched !== true) return false;
  return isNonEmptyString(runState.sessionId) && isNonEmptyString(sessionId) && runState.sessionId === sessionId;
}

function isDispatchTaskCallForRun(runDir, sessionId) {
  if (!isNonEmptyString(runDir)) return false;
  try {
    return isDispatchTaskCall({ runState: readRunState(runDir), sessionId });
  } catch {
    return false;
  }
}

module.exports = { isDispatchTaskCall, isDispatchTaskCallForRun };
