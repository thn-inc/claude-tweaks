// bin/lib/hooks/session-end.js — A2: mark the active run interrupted at session
// end; archive the session's own ad hoc run instead (#3977).
'use strict';
const path = require('path');
const ctxLib = require('./context');

// #3977: the SessionEnd `reason` values after which this session cannot continue.
// Taken from the harness's own hook-input enum (Claude Code 2.1.311:
// clear | resume | logout | prompt_input_exit | other). `clear` and `resume` keep
// the process running, and any value not listed here — a reason a later harness
// adds — is treated as non-terminal until it is verified.
const TERMINAL_SESSION_END_REASONS = Object.freeze(['logout', 'prompt_input_exit', 'other']);

function defaultDeps() {
  const archiveMerged = require('../reconcile/archive-merged');
  return {
    archiveRunDir: archiveMerged.archiveRunDir,
    listStagedItems: archiveMerged.listStagedItems,
    closeRunState: require('./close-run-state').closeRunState,
  };
}

// An ad hoc run (a session friction log that never resumes — a resumed session
// mints a fresh one) is closed and archived by its own ending session when
// nothing in staged/ needs an outcome. Order: the session-end event first (so
// events.jsonl moves with the run, for /claude-tweaks:feedback), then the move,
// then the close against the ARCHIVED copy — moves-first, close-last, as
// archive-merged.js's abandoned-interrupted path does, so a failed move leaves
// the run non-terminal. Nothing writes to the live run dir after the move: a
// late write would recreate it. Returns true when the run was archived.
function closeOwnAdHocRun(ctx, owned, deps) {
  const { isReviewFinding } = require('../run-liveness/disposition');
  const staged = deps.listStagedItems(owned.dir);
  if (!staged.every(isReviewFinding)) return false;
  ctxLib.appendEvent(owned.dir, 'session-end', { reason: ctx.input.reason, sessionId: ctx.input.session_id }, owned.attribution);
  const root = path.resolve(owned.dir, '..', '..', '..');
  let archived = null;
  try { archived = deps.archiveRunDir(root, owned.dir); } catch { archived = null; }
  if (!archived || !archived.ok) {
    // The event is already appended; fall back to today's stamp on the live dir.
    ctxLib.writeRunState(owned.dir, { status: 'interrupted', lastEvent: 'session-end' });
    return true;
  }
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', path.basename(owned.dir));
  try {
    deps.closeRunState(archiveDir, {
      explicit: true,
      callerIdentity: { sessionId: ctx.input.session_id, cwd: ctx.cwd },
      treatCleanAsAlreadyClosed: false,
      closedBy: 'session-end',
    });
  } catch { /* the move landed; archiveRunDir already wrote status clean there */ }
  return true;
}

function run(ctx, deps) {
  // Scoped to a run this session may write to, NOT ctx.runDir (#62). When every
  // non-terminal run belongs to another session there is nothing here to record.
  const owned = ctx.ownedRun || {};
  if (!owned.dir) return {};
  const state = ctxLib.readRunState(owned.dir);
  // A nested `claude -p` started from the owner's session can carry the owner's
  // session id (#3056's run), so its end resolves this run as owned without
  // being this run's session ending. Neither the stamp nor the breadcrumb
  // belongs to this run — the same treatment as a bystander (#3845).
  // Deliberately before the attribution check: another process ending is not
  // this run's event, even on a `fallback` guess.
  if (ctxLib.isNestedSession(state, process.env)) return {};
  const status = state?.status;
  const reason = ctx.input && ctx.input.reason;
  // #3977: the session's own ad hoc run, ending for good, is archived rather
  // than left `interrupted` for a reconcile sweep to find weeks later. Same
  // own-run attribution gate as the stamp below — a guessed run is never closed.
  if (status !== 'clean' && owned.attribution !== 'fallback' && ctxLib.isAdHocRunDir(owned.dir)
    && TERMINAL_SESSION_END_REASONS.includes(reason)) {
    try {
      if (closeOwnAdHocRun(ctx, owned, deps || defaultDeps())) return {};
    } catch { /* never break a session — fall through to the stamp */ }
  }
  // Only stamp `interrupted` on a run this session is known to own.
  //
  // Under a `fallback` attribution the run is a guess, and stamping it is the
  // move that leaves a finished run flagged forever: an unrelated session ends,
  // resolves the newest non-terminal run dir, and writes `interrupted` onto a
  // run whose issue was closed hours earlier. Because that stamp is itself what
  // keeps the run non-terminal, it also keeps the run winning the same fallback
  // for every session that follows — the state is self-perpetuating, which is
  // why the reported runs were still flagged days later.
  //
  // The cost of not stamping is one missing warning about a genuinely
  // interrupted run whose ownership was never recorded. The cost of stamping
  // wrongly is a permanent false one that finishing the work does not clear.
  if (status !== 'clean' && owned.attribution !== 'fallback') {
    ctxLib.writeRunState(owned.dir, { status: 'interrupted', lastEvent: 'session-end' });
  }
  ctxLib.appendEvent(
    owned.dir,
    'session-end',
    { reason: ctx.input.reason, sessionId: ctx.input.session_id },
    owned.attribution,
  );
  return {};
}

module.exports = { run, TERMINAL_SESSION_END_REASONS };
