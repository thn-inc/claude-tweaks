---
files:
  - plugin/skills/_shared/subagent-dispatch-core.md
  - plugin/skills/dispatch/task-prompt.md
  - plugin/skills/review/step3-lens-dispatch.md
  - plugin/skills/_shared/subagent-output-contract.md
---

# Keep a Second Reader in a Dispatched Review

**Persona:** a maintainer running `/claude-tweaks:dispatch`, whose group's second Task call (`review,polish,wrap-up`) runs `/claude-tweaks:review` as a dispatched subagent at `review-effort: medium` or above.
**Goal:** the dispatched review keeps its two-reader reproduction pairs. Nested lens agents are collected inside the same turn, and the call still returns a clean `STATUS:` line.
**Entry point:** a bare `/claude-tweaks:dispatch` drain, or `/claude-tweaks:dispatch #{n}`, on a record whose review step fans out lens agents.
**Success state:** every in-scope lens either reports its pair inside the turn or shows a logged single-read downgrade, its findings marked `unconfirmed`. The call's last line is `STATUS: {WORD}`, and the group never reads as BLOCKED because a lens agent was slow.

## Steps

### 1. Fan out the lens pairs from inside the dispatched call
- **URL:** the second Task call's `/claude-tweaks:review` Step 3 reproduction dispatch
- **Action:** the dispatched reviewer launches each lens pair with the `Agent` tool. Every launch returns launch metadata (an async ack), never the child's reply. The reviewer then makes foreground `sleep 20` Bash calls, at most 60 per wave (20 minutes); a wait call the harness blocks is never retried in another form. Each wait iteration gets one line naming the lenses waited on, the iteration against the bound, and how many children are still pending. The reviewer stops as soon as every child's `<task-notification>` has arrived.
- **Should feel:** like ordinary progress. Each wait line shows the pending count falling, and the turn never goes quiet.
- **Should understand:** a nested `Agent` call from a dispatched agent always launches async. The child's notification reaches the reviewer only while its turn is still alive. A reply that ends without a tool call ends the turn, whatever is still in flight. The full rule is in `_shared/subagent-dispatch-core.md`'s Foreground Execution Discipline.
- **Red flags:**
  - the reviewer judging 3b/3c itself at `low` "because it is a subagent" (the deleted carve-out);
  - a progress-only reply with no tool call while children are pending;
  - any read or tail of a child's `output_file`;
  - a `run_in_background` wait.

### 2. Downgrade a lens that cannot be collected
- **URL:** the same dispatch, when the environment has no `Agent` tool (a cloud routine sandbox) or a lens agent is still silent at the 40th wait
- **Action:** the reviewer judges that lens itself, applying the lens's own checklist as an adversarial self-review. It logs the downgrade with the lens and the cause, and gives the lens the partner-died single-read treatment: its findings enter `unconfirmed`. A silent child is now abandoned.
- **Should feel:** visible and contained. One logged downgrade per affected lens, and the rest of the review carries on.
- **Should understand:** an abandoned child no longer counts as outstanding, so the reviewer's final reply still ends with `STATUS: {WORD}`. `INTERIM_STATUS:` is only for a turn that ends while a wait is still in progress. A child result that arrives after its lens was self-judged is ignored and never changes the verdict.
- **Red flags:**
  - a final reply ending in `INTERIM_STATUS:` after the bound expired, which `/dispatch` reads as BLOCKED;
  - a self-judged finding promoted to `confirmed` without direct verification;
  - a missing downgrade line in `decisions.md`.

### 3. Answer a late re-wake
- **URL:** after the second call's final reply, when an abandoned child's notification arrives later
- **Action:** the dispatched agent is re-woken and replies by repeating its final `STATUS:` line unchanged.
- **Should feel:** inert. The reported outcome does not move.
- **Should understand:** the late result is ignored because its unit was already judged; the repeat exists only so the reply is still graded as a final reply.
- **Red flags:**
  - a re-wake reply that revises findings;
  - a re-wake reply with no `STATUS:` line, which the `SubagentStop` hook logs as a contract violation.

## Origin
- Created during the build of #3078, which also absorbs #3266. Three earlier builds' premise probes falsified the "foreground nested dispatch" decision. Attempt 4's probe (comment 6286350157, Claude Code 2.1.302) showed that a dispatched subagent's child notification arrives in-turn during a foreground `sleep`. The 20-minute bound comes from the final review's transcript measurement: lens agents had a median of 123 s and a p90 of 260 s, and 26% of sessions had at least one lens agent over 300 s.
- Related journeys: `run-a-review-from-a-worktree-isolated-session-2956.md` (the same dispatched review's file writes), `keep-review-lenses-from-running-suites-3001.md` (the same fan-out's leftover sweep), `clear-the-two-call-gate-for-a-dispatched-group-2775.md` (where the second call's `STATUS:` line is read).
