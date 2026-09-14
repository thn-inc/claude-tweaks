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
]);

module.exports = { FRICTION_EVENT_TYPES };
