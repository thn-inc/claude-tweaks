---
files:
  - plugin/bin/lib/hooks/subagent-stop.js
---

# Narrate Right After the Last Child Reports

**Persona:** a maintainer whose `/claude-tweaks:dispatch` Task call runs as a nested dispatcher: a `/build` SDD controller, or a review fanning out lens agents. It runs on Claude Code 2.1.283 or later, where a child's completion arrives as a `queued_command` attachment.
**Goal:** the dispatcher can react to its last child's completion with a short narration line ("Now the one scoped re-review of the fix wave.") without the `SubagentStop` hook grading that line as a final reply.
**Entry point:** any dispatched agent that launches async `Agent` children and replies right after the last one reports.
**Success state:** a narration line right after the last child's completion is not graded. There is no forced `STATUS:` retry, no `contract-violation` event in `events.jsonl`, and no "missing the Subagent Contract status line" system message. The agent's genuine final reply, made after further tool calls, is still graded.

## Steps

### 1. React to the last child's completion
- **URL:** the dispatched agent's own transcript, at the reply after a `queued_command` attachment whose `prompt` carries `<task-notification>`
- **Action:** the last child finishes. Its completion lands as an `attachment` entry of type `queued_command`, and the dispatcher replies with one line of narration before its next tool call.
- **Should feel:** silent. The turn carries on with no block reason and no warning.
- **Should understand:** the hook skips a reply whose immediately preceding transcript line is an async signal. That signal is a launch ack (`toolUseResult.isAsync`), an `origin.kind: 'task-notification'` entry, or a `queued_command` completion. The same carrier predicate (`completionCarrierBody`) feeds the pending-dispatch count, so the two exemptions cannot disagree about what a completion looks like.
- **Red flags:**
  - a `decision: 'block'` reason quoting this narration line as the reply's first line;
  - a `contract-violation` event logged for a reply that directly follows a completion;
  - an `api-request-blob` request echo treated as a signal. A blob repeats notifications already delivered, so it must not exempt a reply.

### 2. Finish with a graded final reply
- **URL:** the same transcript, after the dispatcher's further tool calls with every child complete
- **Action:** the dispatcher folds in the results, makes more tool calls, and ends its turn.
- **Should feel:** like every other dispatched reply. A missing `STATUS:` line is blocked once and then logged.
- **Should understand:** the exemption covers only the reply immediately after the signal. Once other tool calls intervene and nothing is pending, the reply is graded as before (`#3589` AC2).
- **Red flags:**
  - a final reply without `STATUS:` that escapes grading because a completion appeared somewhere earlier in the transcript.

## Origin
- Created during the build of #3589. It was filed by `/reflect` from #3015's whole-branch review, which found that `countPendingDispatches` read the `queued_command` carrier but `isAsyncWaitSignal` did not. The live survey behind the fix covered 7,105 subagent transcripts. It found 4 replies directly after a `queued_command` completion, and none directly after an `api-request-blob`.
- Related journeys: `keep-a-second-reader-in-a-dispatched-review-3078.md` (the same nested-dispatch shape inside a dispatched review).
