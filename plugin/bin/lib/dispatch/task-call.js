// The dispatch-call discriminator (#3711): decides whether the current call is one of
// /claude-tweaks:dispatch's Task calls, for wrap-up/auto-merge-short-circuit.md's Dispatch-call
// branch. Two writers stamp run-state.json, both via `hooks.js record-worktree`: every call
// stamps `sessionId` (CLAUDE_CODE_SESSION_ID), and the `--dispatch` flag additionally stamps a
// permanent `dispatched: true` and `dispatchSessionId` (the same env id). A Task subagent shares
// its dispatching session's id, so a Task call's own id equals `dispatchSessionId`.
//
// The per-run `dispatched` marker alone is not enough: it is permanent for the run's lifetime, so
// a human running /flow on a run that dispatch once touched — or a human resuming a dispatched run
// in a new session — would read as a Task call and skip the direct-merge path. The session match
// is what separates them, and it compares against `dispatchSessionId`, NOT `sessionId`: a resume
// re-runs a plain `record-worktree` (run-resume-freshness.md), which overwrites `sessionId` with
// the resumer's id but never touches `dispatchSessionId`. Run-states written by a build that
// predates the field have no `dispatchSessionId` (absent, `undefined`) and fall back to
// `sessionId`; a present-but-empty, null, or non-string `dispatchSessionId` is false and does not
// fall back (`--dispatch` with no session id writes null for exactly this reason). The
// fallback's known residual and its removal condition are in
// skills/_shared/policy-deprecations.md ("Dispatch-call discriminator sessionId fallback").
//
// An absent or empty id on either side never matches (`'' === ''` and `undefined === undefined`
// must not count), and nothing here throws — a missing or unreadable run-state.json is a genuine
// human-run session (false), which falls through to the direct-merge path.
'use strict';

const { readRunState } = require('../hooks/context');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isDispatchTaskCall(arg) {
  const { runState, sessionId } = arg || {};
  if (!runState || typeof runState !== 'object' || Array.isArray(runState)) return false;
  if (runState.dispatched !== true) return false;
  const stamped = runState.dispatchSessionId === undefined ? runState.sessionId : runState.dispatchSessionId;
  return isNonEmptyString(stamped) && isNonEmptyString(sessionId) && stamped === sessionId;
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
