// bin/lib/hooks/harness-refusal.js — the text fragments of Claude Code's own
// worktree-isolation Bash refusal ("This session is isolated in the worktree …
// Refusing to run it — …"), measured 2026-10-16 against Claude Code 2.1.x
// (#2783, #3304). This is the one place a wording update lands: both
// post-tool-use-failure.js (the regex) and bash-prefilter.js (the signature)
// derive from it. tools/upstream-drift/manifest.yml's `claude-code` entry asserts
// each fragment against the installed binary, and
// tests/harness-refusal-drift-pin.test.js keeps that manifest and this module in
// lockstep.
//
// Requires nothing, by contract: bash-prefilter.js loads it on every failed Bash
// call, so any require here moves cost onto each of them.
'use strict';

const SESSION_NOUN = 'This session';
const ISOLATION_CLAUSE = ' is isolated in the worktree ';
const REFUSAL_SIGNATURE = 'Refusing to run it';

// Fragments in message order.
const REFUSAL_FRAGMENTS = Object.freeze([SESSION_NOUN, ISOLATION_CLAUSE, REFUSAL_SIGNATURE]);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const HARNESS_ISOLATION_REFUSAL_RE = new RegExp(
  escapeRegex(SESSION_NOUN + ISOLATION_CLAUSE) + '[\\s\\S]*?' + escapeRegex(REFUSAL_SIGNATURE),
);

module.exports = { SESSION_NOUN, ISOLATION_CLAUSE, REFUSAL_SIGNATURE, REFUSAL_FRAGMENTS, HARNESS_ISOLATION_REFUSAL_RE };
