// bin/lib/hooks/session-end.js — A2: mark the active run interrupted at session end.
'use strict';
const ctxLib = require('./context');

function run(ctx) {
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

module.exports = { run };
