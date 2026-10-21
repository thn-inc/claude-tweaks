// bin/lib/hooks/skill-invocation.js — skill-invocation ledger (log tier).
// Records every completed Skill-tool call as a `skill_invoked` typed event in
// the session's owned run's events.jsonl. One event = "the procedure was
// entered" — PostToolUse fires when the tool call returns, BEFORE the skill's
// loaded instructions execute; no completion semantics are implied.
//
// Task 0 findings (empirical, captured 2026-08-13 via a throwaway --settings
// hook; see .claude-tweaks/pipelines/2026-08-13T201329-spec-371-372-373/
// spec-371/work/task0-findings.md for raw payloads):
//   (a) qualified invocation: tool_input.skill = "claude-tweaks:help"
//       ({namespace}:{skill-name}, a plain string).
//   (b) bare invocation: tool_input.skill also accepts an unqualified name
//       (e.g. "help"). It resolves and succeeds internally, but
//       tool_response.commandName echoes back whatever was passed, NOT the
//       resolved qualified name — no field in this payload ever exposes the
//       resolved qualified form for a bare call. This module logs whatever
//       string was passed, verbatim, in either case.
//   (c) a failed ("unknown skill") call fires NO PostToolUse event at all —
//       confirmed by direct measurement, not merely unconfirmed. The failure
//       surfaces only as a tool_result-level error on the transcript, before
//       (or instead of) any PostToolUse dispatch; there is no
//       tool_response.success/is_error field to key off because no event
//       exists for this case. isFailedCall() below is therefore a minimal
//       defensive guard against a future harness change, not a case this
//       module has ever observed firing — it is dead code on today's
//       harness by measurement, kept as cheap insurance.
//   (d) a Skill call inside a Task-dispatched subagent DOES fire the parent
//       session's hooks, under the parent's own session_id, tagged with
//       extra agent_id/agent_type fields. Per the spec's Non-Goals, this
//       module does not filter or special-case those — they are logged like
//       any other skill_invoked event.
//   (e) a user-typed slash command (e.g. "/claude-tweaks:help") runs by
//       direct content expansion with NO Skill tool call at all — the
//       PostToolUse Skill matcher captures nothing (verified with a
//       matcher-less control capture showing only Read/ToolSearch tool use).
//       Measured headless (`claude -p`) only; interactive CLI uses the same
//       slash-expansion path but was not measured non-interactively. This
//       ledger therefore records MODEL-INITIATED Skill tool calls only: the
//       typed form is recorded by user-prompt-submit.js with `source: "user"`,
//       and this module's lines carry no `source`, meaning model-initiated.
'use strict';
const ctxLib = require('./context');

function extractSkillName(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const skill = toolInput.skill;
  return typeof skill === 'string' && skill ? skill : null;
}

// Defensive guard only — see the header comment's (c). Not known to ever
// fire on the current harness (a failed call never reaches PostToolUse at
// all), kept in case a future harness change starts delivering a failure
// signal on this path instead of dropping the event entirely. Removal
// condition: delete this guard if a future recapture still shows no
// PostToolUse event for failed calls.
function isFailedCall(toolResponse) {
  if (!toolResponse || typeof toolResponse !== 'object') return false;
  return toolResponse.success === false || toolResponse.is_error === true;
}

function run(ctx) {
  if (ctx.input.tool_name !== 'Skill') return {}; // defense-in-depth; the router already gates on this
  const skill = extractSkillName(ctx.input.tool_input);
  if (!skill) return {};
  if (isFailedCall(ctx.input.tool_response)) return {};
  const ownedRun = ctx.ownedRun || {};
  if (!ownedRun.dir) return {}; // no run, or every run foreign-owned — drop, by design
  ctxLib.appendEvent(ownedRun.dir, 'skill_invoked', { skill }, ownedRun.attribution);
  return {};
}

module.exports = { run, extractSkillName, isFailedCall };
