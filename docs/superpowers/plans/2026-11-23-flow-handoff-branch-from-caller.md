# Flow context-handoff branch from the caller (#5270) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/flow`'s context-cap handoff picks the Dispatched call branch only when the agent was itself launched by `/claude-tweaks:dispatch`. That launch is marked by a prompt starting `[dispatch-prompt: {run-id} {call}]`. The run's `run-state.json` `dispatched: true` flag no longer decides it.

**Architecture:** This is a prose-only change in `plugin/skills/flow/`, pinned by `tests/flow-context-handoff-conformance.test.js`. The express-lane worker already committed an unverified draft at `376607308` (`git show 376607308`). Its edits cover `context-handoff.md`, `SKILL.md` Step 4 item 4 and the test file. This task verifies that draft, completes it and corrects it. It does not start over.

**Tech Stack:** Markdown skill prose; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T151537-record-5270/work/5270-spec.md`

## Global Constraints

- Every `/flow` call that `/claude-tweaks:dispatch` launches (first, second and continuation calls) has a prompt starting with the marker. `dispatch-prompt.js` renders all three, and `plugin/bin/lib/dispatch/task-prompt.js` defines `MARKER_RE = /^\[dispatch-prompt: (\S+) (first|second)\](?:\n|$)/`. In prose, cite the marker as `[dispatch-prompt: {run-id} {call}]`.
- Step 1 rung 2's `dispatched` read (mode resolution, and `pre-authorize-merge`'s ignore rule) is unchanged. Only the context-handoff branch choice and the `wrap-up` exclusion move to the caller signal.
- `plugin/bin/context-gauge.js`'s code check (#5253) still refuses `wrap-up` in `--next-steps` when `run-state.json` is not `dispatched: true`. Leave that code alone: a top-level caller now never passes `wrap-up`, so the check never fires on it.
- `plugin/skills/flow/SKILL.md` is at 52,049 B. `RAIL_BYTES` is 52,500, and base was 51,924. The item 4 sentence must not leave the file over the rail, so keep the replacement no longer than the draft's.
- From `.claude/skills/skill-prose-conformance-tests/SKILL.md`: "Prove go-red with a frozen pre-change excerpt beside the live file" and "New prose has no pre-change bytes — mutate the live text in memory, and match the failure to its own assertion". This test file's `assertEachFactGoesRed` helper implements the second rule, so use it for the new facts.
- Surgical: keep every other sentence in the touched paragraphs as it is.

## Review Focus

- A human-typed resume of a `dispatched: true` single-spec run that crosses the cap must take Top-level. It must keep `wrap-up` out of `--next-steps` and run `wrap-up` itself.
- A dispatcher continuation call (second call, or a `NEXT_STEPS` continuation) still carries the marker, so it still reports `OUTCOME: handoff`.
- A multi-spec bundle: `multi-spec.md`'s Context cap gives the old `dispatched` read as the reason for reading the parent run dir. After this change the parent is still the gauge's `{run}` and holds `handoff.json`, but no branch is read from it.
- A top-level run's handoff child takes the Top-level branch: its prompt is the handoff template, which carries no marker.
- Stale prose: the journey doc still calls a dispatched call "`run-state.json` `dispatched: true`".

---

### Task 1: Select the handoff branch by caller across flow prose, journey and tests

**Files:**
- Modify: `plugin/skills/flow/context-handoff.md` — "Never `wrap-up` from a top-level run" bullet, `## Reading the result`'s branch paragraph, the `## Dispatched call` and `## Top-level run` opening sentences. The draft already edits these. Fix the draft's dangling "it prints nothing of the kind" clause. Restore the multi-spec sentence so it says only that `{run}` and `handoff.json` are the parent's.
- Modify: `plugin/skills/flow/SKILL.md` — Step 4 item 4's "A run not bound `dispatched: true` …" sentence. The draft already replaces it; keep it within the byte budget.
- Modify: `plugin/skills/flow/multi-spec.md` — `## Context cap (sequential runs)`. Make two changes. (a) The parent-run paragraph: remove "the `dispatched` read targets `$MULTISPEC_PARENT_DIR`," and the "A read against `spec-{N}/` prints nothing and would misroute a dispatched bundle to the Top-level branch." sentence, and keep "`{run}` and `handoff.json` are the parent's". (b) "A run not bound `dispatched: true` leaves `wrap-up` off every list" becomes "A session not launched as a dispatch Task call (`context-handoff.md`'s branch rule) leaves `wrap-up` off every list".
- Modify: `docs/journeys/hand-a-phase-to-a-fresh-agent-at-the-context-cap-4027.md` — lines 38, 42 and 49. On 38, the red flag becomes "a `handoff.json` naming `wrap-up` from a session not launched as a dispatch Task call". On 42, "a run not bound `dispatched: true` by Step 1 rung 2's read" becomes "a session whose prompt does not start with the `[dispatch-prompt: {run-id} {call}]` marker, even on a `dispatched: true` run". On 49, "`run-state.json` `dispatched: true`" becomes "its prompt starts with the `[dispatch-prompt: {run-id} {call}]` marker". Line 37 describes the gauge's code check, which is still true, so it does not change.
- Test: `tests/flow-context-handoff-conformance.test.js`
- No-change (swept): `plugin/skills/flow/steps-and-gates.md` line 139 ("hands a dispatched call's remaining steps") is still true. Step 1 rung 2 in `SKILL.md` stays, per Global Constraints.

- [ ] **Step 1: Tests**. Edit `tests/flow-context-handoff-conformance.test.js`:
  - `CONTEXT_CAP_FACTS`: drop the two facts `the dispatched read targets the parent` and `why: a per-spec read prints nothing`. Replace the `leaves \`wrap-up\` off every list` fact with `/A session not launched as a dispatch Task call \(`context-handoff\.md`'s branch rule\) leaves `wrap-up` off every list/`.
  - `PARENT_RUN_FACTS`: drop `the dispatched read targets the parent` and keep the `{run}`/`handoff.json` fact.
  - Delete the draft's loosened test `an empty dispatched read lands on the top-level branch`. The #5270 test subsumes it.
  - Rewrite the draft's #5270 test as `AC1.1/AC2.1/AC3.1: the handoff branch follows the caller's dispatch-prompt marker, not run-state dispatched (#5270)`. Use a `CALLER_BRANCH_FACTS` array checked with `assertEachFactGoesRed` over the squashed `## Reading the result` region. The facts are: the Dispatched call branch only when this agent's own prompt starts with the `[dispatch-prompt: {run-id} {call}]` marker; with no such prompt (human-typed or Routine-typed `/flow`), whatever `run-state.json` says, the Top-level run branch. Also assert that `## Top-level run` says `even on a \`dispatched: true\` run`, that `## Dispatched call` names the marker, and that `stepFourItem()` names the marker.
  - Fact patterns must match their own clause only, because `assertEachFactGoesRed` requires that.
- [ ] **Step 2: Run** `node --test tests/flow-context-handoff-conformance.test.js`. Expected: FAIL on `CONTEXT_CAP_FACTS` (multi-spec.md not yet edited) and on the reworded facts.
- [ ] **Step 3: Implement** the prose edits listed under Files.
- [ ] **Step 4: Run** `node --test tests/flow-context-handoff-conformance.test.js tests/dispatch-handoff-continuation-conformance.test.js` and `wc -c plugin/skills/flow/SKILL.md`. Expected: PASS, and at most 52,500 bytes.
- [ ] **Step 5: Commit** the five files: `Pick flow's context-handoff branch from the caller — dispatch-prompt marker, not run-state dispatched, refs #5270`.

## Self-review

- **Spec coverage:** Deliverable 1 is the context-handoff.md and SKILL.md edits. Deliverable 2 is the Top-level branch excluding `wrap-up`, from the bullet, the item 4 sentence and the multi-spec list rule. AC1.1 is the Reading-the-result facts plus the Top-level "even on a `dispatched: true` run" fact. AC2.1 is the Dispatched call marker fact. AC3.1 is the prose test.
- **Placeholders:** none.
