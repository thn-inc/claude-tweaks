// bin/lib/hooks/subagent-stop.js — E3: Subagent Contract status-line check (warn tier).
// Best-effort by design: SubagentStop fires unreliably for Task dispatches
// (claude-code#27755) and transcript field names may drift. Never blocks.
// Two-tier canonical/lenient detection (#2265 — migrated the canonical
// status signal from a first-line bare word to a labeled trailing line):
//   1. Canonical — the reply's LAST non-empty line reads exactly
//      "STATUS: {WORD}". Fully compliant, nothing logged.
//   2. Lenient fallback — the bare word, or an off-position "STATUS: {WORD}"
//      line, appears as the first token of one of the reply's first-or-last
//      3 non-empty lines (markdown table rows excluded from that window).
//      Compliant (no dispatcher-facing warning), but an informational
//      contract-violation event variant is logged so a stale dispatch site
//      still using the old shape stays visible. This same rule is what
//      makes the format migration itself safe with no explicit transition
//      period — an in-flight dispatch given an old-format prompt (status
//      word first) is still accepted here.
//   3. Neither — genuine violation, logged exactly as before.
// Known false-positive sources:
// 1. A dispatch whose own template specifies a different status contract
//    (e.g. superpowers:subagent-driven-development's task-reviewer, which
//    begins with a spec-compliance verdict) is logged here even though
//    nothing was actually violated — the detector has no way to know a
//    dispatch declared a different contract.
// 2. (fixed, #1928) The parent session's own transcript used to be graded
//    whenever agent_transcript_path was absent, so an orchestrator's interim
//    narration turns were logged as violations. Absent agent_transcript_path
//    is now a no-op; a harness that stops sending the field silently
//    disables this check rather than flooding the log.
// 3. (fixed, #2036) #1928 closed the absent-agent_transcript_path case, but
//    left one shape open: a SubagentStop firing whose agent_transcript_path
//    is PRESENT yet identical to the same event's own transcript_path — the
//    dispatching session's own file, not a distinct subagent session. This
//    happens while a main session ends its turn per the documented async-wait
//    convention (agent-tool-async-wait-pattern.md: status message, no tool
//    call, while awaiting an Agent-tool dispatch's async notification) —
//    claude-code#27755's unreliable SubagentStop firing attributes that
//    narration turn to "agent_transcript_path" instead of leaving the field
//    absent. Graded, it misfires on the orchestrator's own status narration
//    ("Waiting on the code-simplifier subagent to return…") as if it were a
//    subagent's final reply missing its status line. A genuine subagent stop
//    always carries its OWN distinct transcript file, so this equality check
//    can never suppress a real violation — only this known-unreliable shape.
'use strict';
const fs = require('fs');
const ctxLib = require('./context');

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
// words appearing later in a sentence, still falls through to tier 3 below.
// Same case-sensitive word alternation as CANONICAL_RE, applied off-position
// (tier 2's "lenient" half) rather than requiring the exact whole-line match
// tier 1 does.
const LENIENT_RE = /^(?:-\s+)?(?:\*\*Status:\*\*\s+)?(?:STATUS:\s+)?(DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED)\b/;

// Three-tier canonical/lenient/violation classification (#2265). `text` is
// the already-trimmed last-assistant-turn text.
function detectStatus(text) {
  const nonEmpty = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return { compliant: false, variant: null };
  const last = nonEmpty[nonEmpty.length - 1];
  if (CANONICAL_RE.test(last)) return { compliant: true, variant: 'canonical' };
  // Tier 2: the candidate window is the first-or-last 3 non-empty lines,
  // checked as a union (a short reply's windows may overlap — harmless,
  // .some() doesn't care about duplicates). Markdown table rows (a
  // Template A findings table's own cells) are excluded from the window
  // entirely so a matching word inside a table cell can never produce a
  // false lenient-compliant match when the reply's real trailing status
  // line is missing or malformed (#2265 AC7).
  const candidates = nonEmpty.filter((l) => !l.startsWith('|'));
  const window = candidates.slice(0, 3).concat(candidates.slice(-3));
  if (window.some((l) => LENIENT_RE.test(l))) return { compliant: true, variant: 'lenient' };
  return { compliant: false, variant: null };
}

// This plugin's own name (plugin/.claude-plugin/plugin.json's "name" field) —
// the same literal already hardcoded in post-tool-use.js's manifest check.
// No shared constant module exists for it yet; this is the second call site,
// not a third, so introducing one is left for whenever a third appears.
const OWN_PLUGIN_NAMESPACE = 'claude-tweaks';

// #1596: the Subagent Contract's Exemption section (subagent-output-contract.md)
// exempts an agent whose definition file lives outside this plugin's own
// `agents/` directory — it ships with a third-party plugin and was never
// given the status-line format, so a "malformed" reply from it is not
// evidence of a violation at all. The SubagentStop hook's `agent_type` input
// field (present "when the session uses --agent or the hook fires inside a
// subagent call", per Claude Code's own hooks reference) carries that
// plugin's namespace as a `plugin:agent-name` prefix for a real plugin agent
// (e.g. "code-simplifier:code-simplifier", "impeccable:impeccable-finish-reviewer").
// A bare type with no namespace (e.g. "general-purpose", "Explore") is a
// harness built-in Task type — claude-tweaks' own ad hoc fan-out dispatches
// use these, so they are NOT exempt: the contract's prompt, not the agent
// type, governs those. `claude-tweaks:{name}` (this plugin's own agents/
// directory) is likewise never exempt, per the contract's own "never exempt"
// rule for this plugin's own agents.
function isExemptAgentType(agentType) {
  if (typeof agentType !== 'string' || !agentType) return false;
  const idx = agentType.indexOf(':');
  if (idx === -1) return false;
  return agentType.slice(0, idx) !== OWN_PLUGIN_NAMESPACE;
}

function lastAssistantText(transcriptPath) {
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }
  const lines = raw.split('\n');
  // Scan from the tail and stop at the first assistant message found — the
  // last assistant message is almost always near the end of a long-running
  // transcript, so this avoids JSON.parse-ing every earlier line just to
  // confirm none of them is the true last one.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const msg = entry && entry.message;
    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    // This IS the transcript's true last assistant turn (first match found
    // scanning backward) — decide based on IT alone and stop here. Falling
    // through to an EARLIER assistant message when this one has no text
    // blocks (e.g. a tool-call-only final turn) would silently grade stale,
    // unrelated content instead of correctly recognizing "the real last
    // turn had nothing to grade" — matching this file's own best-effort
    // posture (unreadable/ungradable -> no-op, not a violation).
    //
    // A message that ALSO carries a tool_use block is not a completed reply
    // either, even when it carries narration text alongside the tool call
    // (e.g. "Waiting for the other task to finish." immediately before
    // calling Monitor/SendMessage) — the turn continues after the tool
    // result comes back, so this narration precedes the eventual final
    // reply rather than being it. Grading it here is the same category of
    // misfire as the tool-call-only case above: nothing to grade yet (#1329).
    if (msg.content.some((c) => c && c.type === 'tool_use')) return null;
    const texts = msg.content.filter((c) => c && c.type === 'text' && typeof c.text === 'string');
    return texts.length ? texts[texts.length - 1].text : null;
  }
  return null;
}

function run(ctx) {
  // Scoped to ctx.ownedRun, NEVER ctx.runDir: the latter is the session-agnostic
  // newest-non-terminal resolution, so with parallel sessions active a sibling
  // session's Task-agent stop would stamp whichever run dir happens to be newest
  // — polluting a foreign run's audit trail while the run that actually owned the
  // violation records nothing. Same pattern and rationale as pre-tool-use.js's
  // gate-denial breadcrumb ([IL-96]); degrades to a silent no-op when this
  // session owns no run, matching skill-invocation.js's identical guard.
  const ownedRun = ctx.ownedRun || {};
  if (!ownedRun.dir) return {};
  if (isExemptAgentType(ctx.input.agent_type)) return {}; // third-party agent — never governed by this contract; checked before the transcript read below so an exempt stop never pays that I/O cost
  // #1928: only a real agent transcript is graded. The former fallback to
  // the parent session's transcript_path scored the orchestrator's own
  // narration as a subagent reply — the bulk of the corpus's false fires.
  const transcriptPath = ctx.input.agent_transcript_path;
  if (typeof transcriptPath !== 'string' || !transcriptPath) return {};
  // #2036: agent_transcript_path identical to this same event's own
  // transcript_path means the harness never actually separated a distinct
  // subagent transcript from the dispatching session's own — see the header
  // comment's false-positive source 3. Best-effort no-op, matching this
  // file's own posture.
  // transcriptPath is already a confirmed non-empty string (checked above),
  // so a straight equality test already implies mainTranscriptPath is one too.
  if (ctx.input.transcript_path === transcriptPath) return {};
  const text = lastAssistantText(transcriptPath);
  if (typeof text !== 'string') return {}; // unreadable -> best-effort no-op
  const trimmedText = text.trim();
  const firstLine = trimmedText.split('\n')[0].slice(0, 120);
  const detection = detectStatus(trimmedText);
  if (detection.compliant) {
    // Lenient (off-position/bare-word) compliance is still logged — an
    // informational variant, never a dispatcher-facing warning — so a
    // dispatch site still using the old shape stays visible without being
    // treated as a violation (#2265).
    if (detection.variant === 'lenient') {
      ctxLib.appendEvent(ownedRun.dir, 'contract-violation', { firstLine, variant: 'lenient' }, ownedRun.attribution);
    }
    return {};
  }
  ctxLib.appendEvent(ownedRun.dir, 'contract-violation', { firstLine }, ownedRun.attribution);
  return { json: { systemMessage: 'claude-tweaks: a subagent reply is missing the Subagent Contract status line (STATUS: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, as the last non-empty line). Logged to events.jsonl.' } };
}

module.exports = { run, isExemptAgentType };
