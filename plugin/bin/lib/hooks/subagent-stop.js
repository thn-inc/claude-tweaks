// bin/lib/hooks/subagent-stop.js — E3: Subagent Contract status-line check.
// Best-effort by design: SubagentStop fires unreliably for Task dispatches
// (claude-code#27755) and transcript field names may drift. One forced
// in-run retry per (session_id, agent_id) on a genuine violation (#1936
// Task 0 — live-confirmed 2026-09-20 against Claude Code v2.1.258 that
// SubagentStop's JSON output supports `{ decision: 'block', reason }`,
// which keeps the subagent running and delivers `reason` as its next
// instruction, exactly as https://code.claude.com/docs/en/hooks documents:
// "SubagentStop hooks use the same decision control format as Stop hooks
// ... Returning decision: 'block' with a reason keeps the subagent running
// and delivers reason to the subagent as its next instruction."); every
// other path — a second violation by the same agent, an exempt agent_type,
// an unreadable/absent transcript — never blocks.
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
//   3. Neither — genuine violation. The first such violation for a given
//      (session_id, agent_id) is blocked once (see above); a second
//      violation by the same agent (or a failure to write the retry
//      counter — see contract-retries.js) falls through to the pre-#1936
//      warn-and-log path, unchanged.
// Known false-positive sources:
// 1. (partially addressed, #2344) A dispatch whose own template specifies a
//    different status contract (e.g. superpowers:subagent-driven-development's
//    task-reviewer, which begins with a spec-compliance verdict, or this
//    plugin's own review-lens/fix-verification dispatches which reply
//    APPROVED/NEEDS_FIXES/ADDRESSED/VERIFIED) used to be logged here even
//    though nothing was actually violated — the detector has no way to know a
//    dispatch declared a different contract. #2344's measurement found this
//    was 26% of one run's contract-violation volume. Addressed by tagging: a
//    reply whose first line is EXACTLY one of the curated FOREIGN_CONTRACT_WORDS
//    below still logs an event (never silently skipped — the aggregation
//    layer, not the detector, is what decides "friction or not"), but tagged
//    `variant: 'foreign-contract'` instead of the genuine `'violation'` tag,
//    and bin/friction-events.js drops that variant from its aggregate the
//    same way it already drops `'lenient'` (#2350). Removal condition for the
//    word list itself: it is a closed, curated set (not a general heuristic)
//    — widen it only when a NEW dispatch site's own declared vocabulary is
//    observed causing the same false-positive shape, never speculatively.
//    A detection-TIME skip (never logging the event at all, keyed off a
//    dispatcher's own pre-declared contract) was considered and deferred —
//    see #2344's own Deliverables for the shape — since the read-time
//    variant tag already satisfies the same downstream goal (the Friction
//    lens's aggregate no longer counts this population) with no new
//    run-dir-state contract for every dispatch site to adopt.
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
//    convention (plugin/skills/_shared/dispatch-waiting.md: status message, no tool
//    call, while awaiting an Agent-tool dispatch's async notification) —
//    claude-code#27755's unreliable SubagentStop firing attributes that
//    narration turn to "agent_transcript_path" instead of leaving the field
//    absent. Graded, it misfires on the orchestrator's own status narration
//    ("Waiting on the code-simplifier subagent to return…") as if it were a
//    subagent's final reply missing its status line. A genuine subagent stop
//    always carries its OWN distinct transcript file, so this equality check
//    can never suppress a real violation — only this known-unreliable shape.
// 4. (fixed, #2041) #2036 only covers the TOP-level dispatcher narrating
//    about its own direct dispatch. A DISPATCHED agent that is itself a
//    nested dispatcher (e.g. a review-phase orchestrator fanning out several
//    lens-review agents) has its own distinct agent_transcript_path, so
//    #2036's equality check never fires — yet the same async-wait convention
//    applies one level down: the orchestrator ends a turn with plain status
//    narration ("Still waiting on the N lens-review agents…") while awaiting
//    ITS OWN children's completions, across possibly several such waits in
//    sequence. Ground-truth transcript capture (this session's own
//    subagents/agent-*.jsonl + its dispatcher's own transcript, read per
//    transcript-payload-verification) confirms the exact structural signal:
//    an Agent-tool dispatch's tool_result always returns promptly with a
//    launch acknowledgment carrying `toolUseResult.isAsync: true` — never the
//    dispatched agent's real output — and each later notification that a
//    sibling dispatch has reported in arrives as its own transcript entry
//    with `origin.kind: 'task-notification'`, also never a tool_result. A
//    text-only final turn immediately preceded by either shape is therefore
//    reacting to "a background dispatch just launched or reported in", not to
//    genuine content it could reply to — logged as a violation, this misfires
//    the same way #2036 does, just one dispatch level deeper. See
//    isAsyncWaitSignal below. (#3589) It recognizes the completion carriers
//    completionCarrierBody names — shared with countPendingDispatches (source 6):
//    an origin-shaped task-notification and a `queued_command` attachment whose
//    prompt is a <task-notification> (Claude Code 2.1.283+). An api-request-blob
//    request echo is deliberately NOT a signal: it repeats notifications already
//    delivered through their own carrier, not a checkpoint the reply reacts to.
// 5. (fixed, #2714) #2041 only catches an interim reply whose IMMEDIATELY
//    PRECEDING transcript entry is itself an async signal. A nested
//    dispatcher's interim reply composed after intervening tool calls
//    (dispatching a further nested agent, reading a sibling's output) no
//    longer has an async signal as its immediately-preceding entry, so #2041
//    never fires even though the reply is still legitimately mid-dispatch.
//    Closed via an explicit marker convention a dispatching agent's own
//    interim replies can carry — see isInterimProgressReply/INTERIM_MARKER_RE
//    below and `_shared/subagent-output-contract.md`'s matching dispatch-side
//    instruction.
// 6. (fixed, #3015) #2041 needs the async signal IMMEDIATELY before the reply
//    and #2714 needs the dispatch prompt to have requested the marker; neither
//    knows whether this agent's own in-turn async `Agent` dispatches are still
//    outstanding. A nested dispatcher that yields after intervening tool calls,
//    its marker-less prompt never having asked for INTERIM_STATUS, was graded
//    (and blocked) mid-wait. countPendingDispatches reads the live-verified
//    shapes (subagents/agent-a39fe70648c970fc6.jsonl, agent-a5b308ad6074b371c.jsonl):
//    a launch is a user entry with `toolUseResult.isAsync: true` carrying
//    `agentId` and the launching `tool_use_id`; a completion's
//    `<task-notification>` body (carrying `<task-id>` / `<tool-use-id>`)
//    arrives in one of two carriers — a user entry with `origin.kind:
//    'task-notification'` and a string `message.content`, or (Claude Code
//    2.1.283 and later) an `attachment` entry of type `queued_command` with a
//    string `prompt`. An `api-request-blob` entry (2.1.302) echoes the
//    request and repeats those notifications; its ids are collected too, which
//    can only lower the count. A launch is pending when neither of its ids
//    appears in any completion (correlated by id, never by count, so a
//    background-Bash notification cannot complete an agent launch). A worker
//    fork's transcript repeats its parent's history up to a `<fork-boilerplate>`
//    user entry; the count restarts there, so only the fork's own launches
//    count. Any indeterminate shape (unparseable line, id-less launch or
//    notification, missing timestamp, `<task-notification>` or
//    `<fork-boilerplate>` in any other carrier — a quoting tool_result included)
//    yields null, which run() grades exactly as before — never a blanket
//    exemption. Bounded by PENDING_DISPATCH_MAX_AGE_MS (60 minutes, mirroring
//    flow/claim-targets.md's liveness default): a launch older than that is
//    presumed hung and no longer hides a real contract violation. Residual
//    risk: within those 60 minutes a hung child (one that never reports) still
//    hides a violating final reply, and nothing re-grades it after the window
//    closes. A skip-count ceiling would not close this: a hung child leaves
//    that skipped yield as the agent's last stop, so there is no later stop
//    for a ceiling to grade.
'use strict';
const fs = require('fs');
const ctxLib = require('./context');
const contractRetries = require('./contract-retries');

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

// #2714: a dispatched agent that is itself a nested dispatcher (fanning out
// further async `Agent`-tool calls) keeps its turn alive until every child
// reports (#3078, `_shared/subagent-dispatch-core.md`'s Foreground Execution
// Discipline); a turn that nonetheless ends mid-wait is an interim reply that
// narrates progress on the still-pending nested work (e.g. "2 of 8 back. Lens 3b-b
// surfaced two HIGH findings…"). The existing `isAsyncWaitSignal`/
// `asyncWaitCheckpoint` filter only catches the narrower case where such a
// turn immediately follows an async signal in the transcript; an interim
// turn composed after intervening tool calls (reading a sibling's output,
// dispatching the next nested agent) has no such signal immediately before
// it, so that filter never fires. This is a SEPARATE, explicit marker
// convention a dispatching agent's own interim (non-final) replies can
// carry — deliberately a different label than `STATUS: {WORD}`
// (`_shared/subagent-output-contract.md`'s Implementer Status Protocol is
// for an agent's FINAL reply only; reusing that same word namespace for an
// interim checkpoint would blur the two). A reply whose last non-empty line
// matches this marker is never graded as a final reply at all — no log,
// not even the informational `'lenient'` variant — the same silent-skip
// shape `asyncWaitCheckpoint` already uses one tier up.
const INTERIM_MARKER_RE = /^INTERIM_STATUS: /;

function isInterimProgressReply(trimmedText) {
  const nonEmpty = trimmedText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return false;
  return INTERIM_MARKER_RE.test(nonEmpty[nonEmpty.length - 1]);
}

// #2344: verdict words belonging to OTHER dispatch-site contracts (this
// plugin's own review-lens/fix-verification dispatch templates, whose own
// prompt declares this vocabulary) — a reply whose first line is EXACTLY one
// of these is not evidence of a Subagent Contract violation, but the
// detector has no way to know a dispatch declared a different contract
// without reading that dispatch's own prompt. Deliberately a closed, curated
// list (not a general heuristic): an unrelated third vocabulary NOT in this
// list still grades as a genuine violation (see the header comment's
// removal-condition note on widening it).
const FOREIGN_CONTRACT_WORDS = new Set(['APPROVED', 'NEEDS_FIXES', 'ADDRESSED', 'VERIFIED']);

// Classifies a NON-compliant reply's `variant` for the logged event (#2344).
// `trimmedText` is the same already-trimmed text detectStatus was run
// against. Only ever called when detectStatus already returned
// `compliant: false` — i.e. this decides "foreign-contract" vs. the default
// "violation", never "lenient" (that variant comes from detectStatus itself).
function classifyViolationVariant(trimmedText) {
  const firstLine = trimmedText.split('\n')[0].trim();
  if (FOREIGN_CONTRACT_WORDS.has(firstLine)) return 'foreign-contract';
  return 'violation';
}

// #2345: total tool-use content blocks across the ENTIRE graded transcript
// (every assistant turn, not just the final one — lastAssistantText already
// guarantees the final graded turn itself never carries a tool_use block
// alongside its text, per its own #1329 handling, so this necessarily counts
// only earlier turns). A verdict/findings/pass-fail claim from an agent whose
// transcript contains zero tool calls read nothing and is a failed dispatch,
// never evidence (`_shared/subagent-output-contract.md`). Returns `null` when
// the transcript can't be read (best-effort no-op, matching this file's own
// posture elsewhere) rather than a count.
function countToolUseBlocks(transcriptPath) {
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }
  let count = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const msg = entry && entry.message;
    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    for (const c of msg.content) { if (c && c.type === 'tool_use') count += 1; }
  }
  return count;
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

// #2041: does `entry` (one already-JSON.parsed transcript line) signal a
// background-dispatch checkpoint rather than real content the model could
// reply to — either an Agent-tool dispatch's own launch acknowledgment
// (`toolUseResult.isAsync: true`, present on the tool_result line the SDK
// writes back immediately, well before the dispatched agent itself finishes)
// or an out-of-band completion notification — an origin-shaped
// task-notification (`origin.kind: 'task-notification'`) or, Claude Code
// 2.1.283+, a `queued_command` attachment whose prompt is a <task-notification>
// (#3589; see completionCarrierBody), a sibling dispatch's completion included?
// A request echo is deliberately NOT a signal (header comment, source 4). The
// shapes were confirmed against this session's own live transcript
// (transcript-payload-verification), never inferred from a fixture. Defensive on shape — an unexpected/missing
// field reads as "not a signal", never throws.
function isAsyncWaitSignal(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.toolUseResult && entry.toolUseResult.isAsync === true) return true;
  if (completionCarrierBody(entry) !== undefined) return true;
  return false;
}

// #3015: an in-turn async `Agent` dispatch older than this with no completion
// notification is presumed hung — it stops exempting a non-compliant reply.
// 60 minutes mirrors flow/claim-targets.md's liveness judgment default.
const PENDING_DISPATCH_MAX_AGE_MS = 60 * 60 * 1000;

// #3015: a worker fork's transcript opens with its parent's full history, then
// this user entry: a `Fork started` tool_result plus a text block opening with
// `<fork-boilerplate>` (live-verified, every one of 188 fork transcripts).
// Launches and completions before it are the parent's, not the fork's.
function isForkBoundary(entry) {
  const content = entry.type === 'user' && entry.message && entry.message.content;
  return Array.isArray(content) && content.some((c) => c && c.type === 'text' && typeof c.text === 'string' && c.text.startsWith('<fork-boilerplate>'));
}

// #3589: the text a completion carrier holds its <task-notification> in —
// `undefined` when `entry` is no completion carrier, a non-string when an
// origin-shaped carrier's body has drifted from the live-verified shape (header
// comment, source 6). Shared by isAsyncWaitSignal and notificationCarrierBody.
function completionCarrierBody(entry) {
  if (entry.origin && entry.origin.kind === 'task-notification') return (entry.message && entry.message.content) ?? null;
  // Only a queued prompt that IS a notification; any other (a relayed message) is ignored like every tag-less line.
  if (entry.attachment && entry.attachment.type === 'queued_command' && typeof entry.attachment.prompt === 'string' && entry.attachment.prompt.includes('<task-notification>')) return entry.attachment.prompt;
  return undefined;
}

// #3015: the text a recognized completion carrier holds its <task-notification>
// in, including the api-request-blob echo (a carrier for counting only, never an
// isAsyncWaitSignal) — `undefined` when `entry` is no carrier.
function notificationCarrierBody(entry, line) {
  const body = completionCarrierBody(entry);
  if (body !== undefined) return body; // not `??`: an origin entry with a null body must not fall through to the blob branch
  if (entry.type === 'api-request-blob' && line.includes('<task-notification>')) return line;
  return undefined;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value ? value : null;
}

// #3015: how many of this transcript's async `Agent` launches (before the
// reply at `replyIndex`) have no completion notification yet? `lines` is the
// raw transcript split on '\n'. -> number, or `null` when the shape is
// indeterminate (run() treats null exactly like 0 — grade as before). See the
// header comment's source 6 for the live-verified shapes and the reasoning.
function countPendingDispatches(lines, replyIndex) {
  let replyTs;
  try { replyTs = Date.parse(JSON.parse(lines[replyIndex]).timestamp); } catch { return null; }
  let launches = [];
  let completed = new Set();
  for (let i = 0; i < replyIndex; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { return null; }
    if (!entry || typeof entry !== 'object') continue;
    if (isForkBoundary(entry)) { launches = []; completed = new Set(); continue; }
    if (line.includes('<fork-boilerplate>')) return null; // a fork marker in a carrier not recognized above
    // Any `isAsync: true` tool result is treated as a launch; today only Agent launches carry it
    // (a background Bash result uses `backgroundTaskId`, not `isAsync`).
    if (entry.toolUseResult && entry.toolUseResult.isAsync === true) {
      const content = entry.message && entry.message.content;
      const first = Array.isArray(content) ? content[0] : null;
      const agentId = nonEmptyString(entry.toolUseResult.agentId);
      const toolUseId = nonEmptyString(first && first.tool_use_id);
      if (!agentId && !toolUseId) return null;
      launches.push({ agentId, toolUseId, ts: Date.parse(entry.timestamp) });
      continue;
    }
    const body = notificationCarrierBody(entry, line);
    if (body === undefined) {
      if (line.includes('<task-notification>')) return null; // a notification in a carrier not recognized above
      continue;
    }
    if (typeof body !== 'string') return null;
    const ids = [...body.matchAll(/<(?:task-id|tool-use-id)>([^<]+)<\/(?:task-id|tool-use-id)>/g)].map((m) => m[1].trim());
    if (!ids.length) return null;
    for (const id of ids) completed.add(id);
  }
  let pending = 0;
  for (const l of launches) {
    if ((l.agentId && completed.has(l.agentId)) || (l.toolUseId && completed.has(l.toolUseId))) continue;
    if (Number.isNaN(replyTs) || Number.isNaN(l.ts)) return null;
    if (replyTs - l.ts > PENDING_DISPATCH_MAX_AGE_MS) continue; // presumed hung
    pending += 1;
  }
  return pending;
}

// -> { text: string|null, asyncWaitCheckpoint: boolean, lines?, replyIndex? }.
// `asyncWaitCheckpoint` is true only when `text` is non-null AND the nearest
// earlier parseable transcript line is an isAsyncWaitSignal hit — i.e. this
// reply is reacting to "a background dispatch just launched or reported in",
// not to genuine content (#2041). `lines`/`replyIndex` (present whenever
// `text` is) let run() compute the #3015 pending-dispatch count lazily.
function lastAssistantText(transcriptPath) {
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch { return { text: null, asyncWaitCheckpoint: false }; }
  const lines = raw.split('\n');
  // Scan from the tail and stop at the first assistant message found — the
  // last assistant message is almost always near the end of a long-running
  // transcript, so finding it never JSON.parse-s the earlier lines (only
  // run()'s #3015 count does, and only for a reply no cheaper check settled).
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
    if (msg.content.some((c) => c && c.type === 'tool_use')) return { text: null, asyncWaitCheckpoint: false };
    const texts = msg.content.filter((c) => c && c.type === 'text' && typeof c.text === 'string');
    if (!texts.length) return { text: null, asyncWaitCheckpoint: false };
    // Look at the nearest earlier parseable line — what this reply is
    // actually reacting to. Blank/unparseable lines are skipped, same
    // tolerance the outer scan already applies.
    let asyncWaitCheckpoint = false;
    for (let j = i - 1; j >= 0; j--) {
      const priorLine = lines[j];
      if (!priorLine.trim()) continue;
      let priorEntry;
      try { priorEntry = JSON.parse(priorLine); } catch { break; }
      asyncWaitCheckpoint = isAsyncWaitSignal(priorEntry);
      break;
    }
    return { text: texts[texts.length - 1].text, asyncWaitCheckpoint, lines, replyIndex: i };
  }
  return { text: null, asyncWaitCheckpoint: false };
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
  const { text, asyncWaitCheckpoint, lines, replyIndex } = lastAssistantText(transcriptPath);
  if (typeof text !== 'string') return {}; // unreadable -> best-effort no-op
  const trimmedText = text.trim();
  const firstLine = trimmedText.split('\n')[0].slice(0, 120);
  // #2345: a graded reply (any final text that reached this point IS, by
  // construction, the exact population the Subagent Contract targets — a
  // dispatched agent's terminal reply) whose transcript carries zero tool-use
  // blocks anywhere is a failed dispatch, never evidence — regardless of
  // whether its status line is otherwise well-formed. Independent of
  // compliance (checked in both branches below); a `null` count (unreadable
  // transcript, which can't actually happen here since lastAssistantText
  // already read it successfully) never logs.
  const toolUseCount = countToolUseBlocks(transcriptPath);
  const detection = detectStatus(trimmedText);
  if (detection.compliant) {
    // Lenient (off-position/bare-word) compliance is still logged — an
    // informational variant, never a dispatcher-facing warning — so a
    // dispatch site still using the old shape stays visible without being
    // treated as a violation (#2265). Compliance is decided before the
    // async-wait filter below is ever consulted.
    if (detection.variant === 'lenient') {
      ctxLib.appendEvent(ownedRun.dir, 'contract-violation', { firstLine, variant: 'lenient' }, ownedRun.attribution);
    }
    if (toolUseCount === 0) {
      ctxLib.appendEvent(ownedRun.dir, 'zero-tool-use-verdict', { firstLine }, ownedRun.attribution);
    }
    return {};
  }
  // #2041: a nested dispatcher's own async-wait narration — reacting to its
  // own dispatch's launch ack or a sibling's task-notification, never to
  // content it could have replied to — is not this agent's final reply.
  // Best-effort no-op, matching this file's own posture (#2036 is the
  // one-level-shallower sibling of this same filter). Must run before the
  // #2345 zero-tool-use-verdict check below: an async-wait checkpoint is not
  // graded at all, so it must log nothing, not even that independent signal.
  if (asyncWaitCheckpoint) return {};
  // #2714: a nested dispatcher's own interim progress-update reply, composed
  // after intervening tool calls (so it has no async signal immediately
  // before it and the #2041 filter above never fires) — not this agent's
  // final reply either. Same silent no-op posture as asyncWaitCheckpoint
  // immediately above: must run before the #2345 zero-tool-use-verdict
  // check below, since an interim checkpoint is not graded at all.
  if (isInterimProgressReply(trimmedText)) return {};
  // #3015: a yield while this agent's own in-turn async Agent dispatches are
  // still pending is not its final reply. Bounded (PENDING_DISPATCH_MAX_AGE_MS);
  // null (indeterminate transcript shape) grades as today. Computed only here,
  // after every cheaper skip, since it parses the whole transcript.
  if (countPendingDispatches(lines, replyIndex) > 0) return {};
  if (toolUseCount === 0) {
    ctxLib.appendEvent(ownedRun.dir, 'zero-tool-use-verdict', { firstLine }, ownedRun.attribution);
  }
  // Genuine violation (tier 3). One forced in-run retry per (session_id,
  // agent_id) — confirmed live (#1936 Task 0) that SubagentStop's JSON
  // output supports `{ decision: 'block', reason }`, which keeps the
  // subagent running and delivers `reason` as its next instruction. Never
  // offered twice for the same agent: a still-violating retry falls straight
  // through to the warn-and-log path below, unchanged from before this tier
  // existed. `recordRetry` returning `false` (no agent_id, or the counter
  // write itself failing — a broken tmp dir) is treated identically to
  // "already retried" so a write failure can never cause a retry loop.
  const agentId = ctx.input.agent_id;
  const alreadyRetried = agentId ? contractRetries.readRetried(ctx.input.session_id).has(agentId) : true;
  if (!alreadyRetried && contractRetries.recordRetry(ctx.input.session_id, agentId)) {
    return {
      json: {
        decision: 'block',
        reason: 'claude-tweaks Subagent Contract violation: your reply\'s last non-empty '
          + 'line must read exactly "STATUS: DONE" (or DONE_WITH_CONCERNS / NEEDS_CONTEXT / '
          + 'BLOCKED) — a labeled trailing line, never a bare word or opening narration. Your '
          + `reply's first line was: "${firstLine}". Reply again now, ending with the correct `
          + 'trailing STATUS: line.',
      },
    };
  }
  // #2344: a genuine violation vs. a reply belonging to another dispatch
  // site's own declared verdict contract are logged with distinct `variant`
  // tags — see FOREIGN_CONTRACT_WORDS' header comment. Both still log (the
  // aggregation layer, bin/friction-events.js, is what decides "friction or
  // not" — see #2350's identical precedent for the 'lenient' variant).
  const variant = classifyViolationVariant(trimmedText);
  ctxLib.appendEvent(ownedRun.dir, 'contract-violation', { firstLine, variant }, ownedRun.attribution);
  return { json: { systemMessage: 'claude-tweaks: a subagent reply is missing the Subagent Contract status line (STATUS: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, as the last non-empty line). Logged to events.jsonl.' } };
}

module.exports = { run, isExemptAgentType, isAsyncWaitSignal, detectStatus, classifyViolationVariant, countToolUseBlocks, isInterimProgressReply, countPendingDispatches, PENDING_DISPATCH_MAX_AGE_MS };
