// bin/lib/status-line.js — the Subagent Contract's status-line patterns, one
// home for every reader (the SubagentStop hook, the lens-reply parser).
'use strict';

// The reply's last non-empty line must read exactly this — trimmed,
// case-sensitive, one of the four contract words.
const CANONICAL_RE = /^STATUS: (DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED)$/;

// #750: superpowers:subagent-driven-development's implementer-prompt.md
// template asks the dispatched agent to reply with "- **Status:** DONE |
// DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT" (a bold, colon-space-prefixed
// bullet) rather than claude-tweaks' own bare-word or labeled-line contract —
// a real SDD-dispatched agent following its OWN template correctly
// false-positived on every dispatch. The optional `-\s+`, `\*\*Status:\*\*\s+`,
// and `STATUS:\s+` prefixes widen the match to those exact literal shapes
// (bullet dash and/or a bold or plain "Status:"/"STATUS:" label, then one of
// the four contract words) — nothing looser: any other label, or the four
// words appearing later in a sentence, still falls through to tier 3 (subagent-stop.js's detectStatus).
// Same case-sensitive word alternation as CANONICAL_RE, applied off-position
// (tier 2's "lenient" half) rather than requiring the exact whole-line match
// tier 1 does.
const LENIENT_RE = /^(?:-\s+)?(?:\*\*Status:\*\*\s+)?(?:STATUS:\s+)?(DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED)\b/;

module.exports = { CANONICAL_RE, LENIENT_RE };
