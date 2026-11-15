// bin/lib/hooks/harness-refusal.js — the text fragments of Claude Code's own
// worktree-isolation Bash refusal ("This session is isolated in the worktree …
// Refusing to run it — …"), measured 2026-10-16 against Claude Code 2.1.x
// (#2783, #3304). #3819 widened it to the sibling templates: the subject noun is
// "This session" or "This agent", and a worktree whose working directory is gone
// ends "Refusing to run there" instead (the agent-noun and worktree-gone templates
// were measured 2026-10-28 against Claude Code 2.1.302). This is the one place a
// wording update lands: both post-tool-use-failure.js (the regex, via
// classifyRefusal) and bash-prefilter.js (the signatures) derive from it.
// tools/upstream-drift/manifest.yml's `claude-code` entry asserts each fragment
// against the installed binary, and tests/harness-refusal-drift-pin.test.js keeps
// that manifest and this module in lockstep.
//
// Requires nothing, by contract: bash-prefilter.js loads it on every failed Bash
// call, so any require here moves cost onto each of them.
'use strict';

const SESSION_NOUN = 'This session';
const AGENT_NOUN = 'This agent';
const ISOLATION_CLAUSE = ' is isolated in the worktree ';
const REFUSAL_SIGNATURE = 'Refusing to run it';
const WORKTREE_GONE_SIGNATURE = 'Refusing to run there';

// Signature tails, for a raw-substring prefilter.
const REFUSAL_SIGNATURES = Object.freeze([REFUSAL_SIGNATURE, WORKTREE_GONE_SIGNATURE]);

// Fragments: the two nouns, the isolation clause, then the two signatures.
const REFUSAL_FRAGMENTS = Object.freeze([SESSION_NOUN, AGENT_NOUN, ISOLATION_CLAUSE, REFUSAL_SIGNATURE, WORKTREE_GONE_SIGNATURE]);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const HARNESS_ISOLATION_REFUSAL_RE = new RegExp(
  '(' + escapeRegex(SESSION_NOUN) + '|' + escapeRegex(AGENT_NOUN) + ')' + escapeRegex(ISOLATION_CLAUSE)
  + '[\\s\\S]*?(' + escapeRegex(REFUSAL_SIGNATURE) + '|' + escapeRegex(WORKTREE_GONE_SIGNATURE) + ')',
);

// Who was refused (`actor`) and by which template (`variant`), or null when the
// text is not a harness isolation refusal.
function classifyRefusal(text) {
  if (typeof text !== 'string') return null;
  const m = HARNESS_ISOLATION_REFUSAL_RE.exec(text);
  if (!m) return null;
  return {
    actor: m[1] === SESSION_NOUN ? 'session' : 'agent',
    variant: m[2] === WORKTREE_GONE_SIGNATURE ? 'worktree-gone' : 'guard',
  };
}

module.exports = {
  SESSION_NOUN, AGENT_NOUN, ISOLATION_CLAUSE, REFUSAL_SIGNATURE, WORKTREE_GONE_SIGNATURE,
  REFUSAL_SIGNATURES, REFUSAL_FRAGMENTS, HARNESS_ISOLATION_REFUSAL_RE, classifyRefusal,
};
