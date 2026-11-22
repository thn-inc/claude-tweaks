// bin/lib/hooks/pre-compact.js — A3: breadcrumb so compaction cannot lose the run.
'use strict';
const ctxLib = require('./context');

function run(ctx) {
  ctxLib.requireEnv(ctx);
  // Ownership-scoped, same as session-end.js — see bin/hooks.js (#62).
  const owned = ctx.ownedRun || {};
  if (!owned.dir) return {};
  ctxLib.appendEvent(
    owned.dir,
    'pre-compact',
    { trigger: ctx.input.trigger, sessionId: ctx.input.session_id },
    owned.attribution,
  );
  // Unlike session-end's `interrupted`, this stamp is not sticky — but it still
  // overwrites another session's `lastEvent` with an event that never happened
  // to it, so it is gated the same way.
  if (owned.attribution !== 'fallback') ctxLib.writeRunState(owned.dir, { lastEvent: 'pre-compact' }, { env: ctx.env });
  return {};
}

module.exports = { run };
