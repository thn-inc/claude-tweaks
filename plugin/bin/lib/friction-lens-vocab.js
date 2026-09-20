// bin/lib/friction-lens-vocab.js — canonical event-type vocabulary for the
// reflect Friction Lens (skills/reflect/full-mode.md's
// `friction-lens-vocab:begin`/`:end` block). Shared between
// bin/friction-events.js (the CLI that filters events.jsonl down to this
// list before output) and tests/reflect-friction-lens-vocab.test.js (which
// pins this list against that same doc block) — one constant instead of two
// independently-drifting copies (#2016).
'use strict';

const FRICTION_EVENT_TYPES = Object.freeze([
  'wd-deny',
  'gate-denial',
  'bookkeeping-stamp-deny',
  'contract-violation',
  'ask-user-question',
  // #2282: worktree-isolation-guard refusals that previously left no
  // friction-event trace at all — checkTeardownGate's own-cwd-removal deny
  // and checkPipelineShadowGuard's shadow-run-dir-creation deny (both in
  // bin/lib/hooks/pre-tool-use.js), neither of which is checkWorktreeRequired's
  // own already-logged gate-denial path.
  'wd-guard-refusal',
  // #2345: a verdict/findings/pass-fail claim from an agent whose transcript
  // carries zero tool-use blocks — a failed dispatch, never evidence.
  'zero-tool-use-verdict',
]);

module.exports = { FRICTION_EVENT_TYPES };
