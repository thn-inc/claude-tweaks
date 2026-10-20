# Nested-dispatch keep-alive + fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the falsified "foreground nested dispatch" premise with one rule: a dispatched agent's nested `Agent` children always launch async, are collected in-turn under a bounded keep-alive wait, and fall back to a logged, `unconfirmed` self-judgement when no `Agent` tool exists or a child times out.

**Architecture:** The rule is defined once, in `_shared/subagent-dispatch-core.md`'s Foreground Execution Discipline. `review/step3-lens-dispatch.md` cites it and loses its low-tier carve-out. `dispatch/task-prompt.md`'s two fenced templates restate it, because each is inlined verbatim into a `Task()` prompt. The keep-alive primitive the rule names is whatever Task 1's probe proves, not a recalled one.

**Tech Stack:** Markdown skill files; `node --test` conformance tests.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T075234-spec-3078/work/3078-spec.md` (record #3078; absorbs #3266)

## Global Constraints

- Task 1 runs and is recorded on #3078 before any commit touches `plugin/skills/_shared/subagent-dispatch-core.md`.
- No `Agent`/`Task` tool in the probe environment → stop `BLOCKED` ("the probe needs an Agent tool; build this record locally"). Never write contract text from an unprobed primitive.
- Leave `plugin/bin/lib/hooks/subagent-stop.js` and `plugin/skills/_shared/dispatch-waiting.md` unchanged.
- `plugin/skills/review/step3-lens-dispatch.md` is 48488 bytes against `RAIL_BYTES` 52500 (`plugin/bin/lib/skill-audit/budgets.js`): its net size must not grow. Rewrite, never append, in all three contract files.
- `tests/review-dispatch-composition.test.js` no longer defines `CEILING_BYTES`; composed size is the rail suite's job (decision 0024). Both suites must stay green under `npm test`.
- Commit messages: `{Verb} {what} — {detail}`, `refs #3078` (never `fixes`/`closes`), ending with `Claude-Session: https://claude.ai/code/session_019Sezsh2cmq9imQXj8wDeTd`.
- `{PRIMITIVE}` below stands for the exact keep-alive wording Task 1 reports. Default if the probe passes as designed: "bounded foreground waits — repeated `sleep 20` Bash calls, at most 15 (5 minutes), stopping as soon as every child's `<task-notification>` has arrived, never reading or tailing a child's `output_file`".

Waived AC1.1: an operational artifact (a comment on #3078) checked at review by its timestamp against the first commit touching the core file, not a test.
Waived AC6.1: the full suite run itself, in Task 5, which is folded into `/build`'s Common Step 5.

## Review Focus

- A child's notification that lands after its unit was self-judged: the rule must say it is ignored, never re-opening a reported verdict (Task 2 test asserts "ignored").
- A cloud sandbox with no `Agent` tool at runtime: the rule's fallback must read as the normal path, not an error (Task 2 test asserts the no-tool fallback clause).
- `_shared/subagent-output-contract.md:81` currently tells a nested dispatcher it "must yield control across several of its own turns" — a direct contradiction of keep-alive found while planning (not in the spec's Key Files; added under scope-creep `add-to-plan`). Task 2 rewrites its first sentence and tests it.
- The `INTERIM_STATUS` marker rule (#2714) must survive, re-anchored on the failure path (Task 4 test).
- `tests/review-lens-no-suites-conformance.test.js:83,88` pins step3's `> **Foreground Execution Discipline:**` note as one line mentioning `Vacuity-evidence diagnostic` and `SCRATCH:` — Task 3's extension must keep both on that same line.

---

### Task 1: Keep-alive probe (Deliverable 2)

**Files:** none committed. Output is a comment on #3078.


**Interfaces:**
- Produces: `PROBE_PRIMITIVE` (the exact keep-alive wording, verbatim, for Tasks 2-4), `PROBE_COMMENT_URL`, and the raw outcome — all in your report.

You are yourself a dispatched subagent; run the probe from here.

- [ ] **Step 1: Confirm the tool.** Check whether you have an `Agent` (or `Task`) tool, loading it with `ToolSearch` if it is deferred. None → report `STATUS: BLOCKED` with "probe needs an Agent tool; build this record locally" and stop.
- [ ] **Step 2: Record `claude --version`** (plain Bash call).
- [ ] **Step 3: Launch one trivial child** — `Agent` with prompt `Reply with exactly the line PROBE-CHILD-DONE and nothing else.` Record the launch tool result's shape verbatim (expect "Async agent launched…" plus an `output_file`), and do not read that file.
- [ ] **Step 4: Run the keep-alive primitive.** Repeated foreground Bash calls of exactly `sleep 20`, at most 15. After each call returns, check whether a `<task-notification>` for the child has been delivered; stop at the first one that has. Never read, tail or `grep` the child's `output_file`.
- [ ] **Step 5: Verdict.** The notification arrived within the bound → PASS; record the iteration number and the notification's status and result text. No notification after 15 calls → report `STATUS: BLOCKED` with the raw record, write no contract text, and still post Step 6.
- [ ] **Step 6: Post the record** (AC1.1) with `gh issue comment 3078 --body-file {scratch file}`. The body is headed `## Deliverable 2 keep-alive probe — attempt 4: {PASS|FAIL}` and contains the version, the launch result shape, the exact commands, the iteration count, and the raw notification excerpt. Report the comment URL and `PROBE_PRIMITIVE`: the default wording in Global Constraints if Step 4 ran as written, or the variant you actually ran.

### Task 2: Core rule in `subagent-dispatch-core.md` (Deliverable 3) + output-contract consistency

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md:43-67` (Foreground Execution Discipline, up to but excluding `**Bounded polling for a long external wait.**`) and `:237` (delete the `**No \`Task\`/Agent tool available.**` paragraph — it is folded into the new fallback clause)
- Modify: `plugin/skills/_shared/subagent-output-contract.md:81` (first two sentences only)
- Test: `tests/foreground-execution-instruction.test.js`


**Interfaces:**
- Consumes: `PROBE_PRIMITIVE` from Task 1.
- Produces: the section heading `## Foreground Execution Discipline`, unchanged, which Tasks 3-4 cite by name; test helper `coreForegroundSection(text) -> string` (heading to the next `## `).

- [ ] **Step 1: Write the failing tests** (AC2.2, AC3.1, AC5.1) in `tests/foreground-execution-instruction.test.js`, following the file's existing style:
  - `test('subagent-dispatch-core.md states the nested-dispatch keep-alive rule and its fallback (#3078)')` — in `coreForegroundSection(core)`, assert `/always launches async/i`, `/keep[s]? (?:its|your|the) (?:own )?turn alive/i`, `/never end[s]? (?:its|your|the) turn with (?:a|one) child outstanding/i`, `/no `Agent`\/`Task` tool/i`, `/`unconfirmed`/`, `/ignored/i`; and assert the whole file `doesNotMatch(/\*\*No `Task`\/Agent tool available\.\*\*/)`.
  - `test('subagent-output-contract.md no longer tells a nested dispatcher to yield across turns (#3078)')` — `doesNotMatch(/must yield control across several of its own turns/)`; `match(/INTERIM_STATUS/)`.
  - `test('the keep-alive predicate can go red (discrimination proof)')` — the section with the new nested-children paragraph removed (doctor by dropping the paragraph that matches `/always launches async/`) fails at least one keep-alive assertion; the output contract with the old sentence re-inserted matches the forbidden pattern.
- [ ] **Step 2: Run to see it fail.** Run: `node --test tests/foreground-execution-instruction.test.js`. Expected: FAIL on the two new content tests.
- [ ] **Step 3: Rewrite the core section.** Replace `:45-67` with three paragraphs, keeping the existing #1965/#2271 evidence and the pointer to `test/verification.md`/`dispatch/task-prompt.md`:
  1. **Background work.** A dispatched agent is never re-woken once its turn ends: a backgrounded `Bash` call or `Monitor` watch ended-on hangs it. Run long commands in the foreground, never `run_in_background`.
  2. **Nested `Agent` children (#3078).** Exact copy, with `{PRIMITIVE}` substituted: "A nested `Agent` call from a dispatched agent always launches async — its tool result is launch metadata, never the child's reply — and the child's `<task-notification>` reaches the agent only while its turn is alive. A dispatched agent may fan out nested agents at every tier (lens pairs, single reads, curation judges), but it keeps its own turn alive with {PRIMITIVE} until every child has reported, and never ends its turn with a child outstanding. A reply that ends without a tool call ends the turn, whatever is still in flight. **Fallback:** when no `Agent`/`Task` tool exists (`ToolSearch` finds none, deferred or otherwise — the normal case in a cloud routine sandbox), or a child has not reported when the bound expires, judge that unit in-session, applying the child's own checklist or template as a genuinely adversarial self-review, log the downgrade (which unit, why), and mark every finding from that unit `unconfirmed`. Never skip the unit or fabricate a dispatch. A child result that arrives after its unit was self-judged is ignored; it never changes a verdict already reached."
  3. **Top-level dispatchers.** One sentence: a top-level session waiting on its own children is `_shared/dispatch-waiting.md`'s pattern, which this section does not restrict.
  Then delete the `:237` paragraph. Its #2644 provenance moves into paragraph 2 as "(#2644, #3078)".
- [ ] **Step 4: Rewrite `subagent-output-contract.md:81`'s first two sentences.** New text: a nested dispatcher keeps its turn alive until every child reports (cite `_shared/subagent-dispatch-core.md`'s Foreground Execution Discipline). A turn that nonetheless ends with a child outstanding is an interim reply, not a final one, and ends with `INTERIM_STATUS: {one-line progress note}`. Keep the rest of the paragraph (the `isInterimProgressReply`/#3015 sentences) unchanged.
- [ ] **Step 5: Run to see it pass.** Run: `node --test tests/foreground-execution-instruction.test.js tests/review-dispatch-composition.test.js tests/subagent-contract-clauses.test.js tests/subagent-dispatch-core-empty-output-prose.test.js tests/session-limit-degrade-conformance.test.js`. Expected: PASS, 0 fail.
- [ ] **Step 6: Commit** — the two contract files and the test file, by explicit path.

### Task 3: Delete the step3 carve-out (Deliverable 4)

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md:50` (delete from `**When the reviewing agent is itself a Task-tool subagent**` to the end of that paragraph) and `:60` (extend the `> **Foreground Execution Discipline:**` note, keeping it on one line)
- Test: `tests/foreground-execution-instruction.test.js`


**Interfaces:**
- Consumes: the core section name from Task 2.

- [ ] **Step 1: Write the failing tests** (AC2.1, AC3.1, AC5.1):
  - `test('step3-lens-dispatch.md has no dispatched-reviewer carve-out (#3078)')`: `doesNotMatch(/cannot safely wait/)`, `doesNotMatch(/skip the Task-tool dispatch for this tier entirely/)`.
  - `test('step3 Foreground note covers the reviewer\'s own lens dispatches (#3078)')`: the single line starting `> **Foreground Execution Discipline:**` matches `/lens dispatches?/i`, `/subagent-dispatch-core\.md/` and `/partner/i` (the single-read downgrade it cites).
  - A go-red proof: the live text with the old carve-out sentence re-inserted at `:50` matches `/cannot safely wait/`.
- [ ] **Step 2: Run to see it fail.** Run: `node --test tests/foreground-execution-instruction.test.js`. Expected: FAIL on the two step3 tests.
- [ ] **Step 3: Edit.** Delete the carve-out sentences, so single reads (`low`) and reproduction pairs (`medium`+) dispatch the same way at any reviewer depth. Append one sentence to the `:60` note: when the reviewer is itself a dispatched agent, its own lens dispatches follow the nested-children rule in `_shared/subagent-dispatch-core.md`'s Foreground Execution Discipline, and a lens whose agents are unavailable or time out takes the partner-died single-read downgrade below (cite it; do not restate it). Then confirm `wc -c` is at or below 48488.
- [ ] **Step 4: Run to see it pass.** Run: `node --test tests/foreground-execution-instruction.test.js tests/review-lens-no-suites-conformance.test.js tests/review-dispatch-composition.test.js`. Expected: PASS, 0 fail.
- [ ] **Step 5: Commit** both files by explicit path.

### Task 4: Rewrite task-prompt item 7, both templates, and the #2533 rationale (Deliverables 5-6)

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md:40-59` (item 7), `:122-131` and `:263-272` (the two `Foreground execution (required):` paragraphs), `:237-240` (the #2533 rationale paragraph)
- Test: `tests/foreground-execution-instruction.test.js`


**Interfaces:**
- Consumes: `PROBE_PRIMITIVE` (Task 1) and the core section name (Task 2).

- [ ] **Step 1: Write the failing tests** (AC2.3, AC2.4, AC2.5, AC3.1, AC4.1):
  - `test('task-prompt item 7 drops "nothing wakes you" and states what ends a turn (#3078, #3266)')`. Take the item 7 block from `7. **Async-wait discipline**` to the next line starting `8. ` or `## `. It `doesNotMatch(/nothing wakes you/)`, matches `/reply that ends without a tool call ends (?:the|your) turn/i`, `/INTERIM_STATUS/`, `/always launches async/i` and `/`unconfirmed`/`.
  - `test('neither fenced template keeps the in-turn carve-out (#3078)')`: for each of the two `fencedBlocks`, `doesNotMatch(/It does not cover an in-turn/)`, `match(/always launches async/i)`, `match(/never end this turn with (?:a|one) child outstanding/i)`. The existing `REQUIRED` test stays as it is and must stay green.
  - `test('the #2533 rationale cites the core section, not dispatch-waiting.md\'s resume signal (#3078)')`: the file `doesNotMatch(/primary resume signal/)` and matches `/subagent-dispatch-core\.md`'s Foreground Execution Discipline/`.
  - Go-red proofs: item 7 with `nothing wakes you` re-inserted fails its predicate, and a template with the old `It does not cover an in-turn` sentence appended fails its predicate. Assert each predicate function returns `false` on the doctored text, like the file's existing discrimination test.
- [ ] **Step 2: Run to see it fail.** Run: `node --test tests/foreground-execution-instruction.test.js`. Expected: FAIL on the three new tests.
- [ ] **Step 3: Rewrite item 7.** Keep the heading and the #2714 marker rule, the #3015 sentence and the forwarding sentence. Replace the "nothing wakes you … one level deeper otherwise" text with these points:
  1. Once your turn ends nothing re-wakes you. A reply that ends without a tool call ends your turn, whatever is still in flight, so a progress note rides alongside a tool call or is skipped (#3266).
  2. Run long commands in the foreground with a large explicit timeout (#1965).
  3. A nested `Agent` call always launches async: keep your turn alive with {PRIMITIVE} until every child you launched has reported, never end your turn with one outstanding, and judge the unit yourself, logging the downgrade and marking findings `unconfirmed`, when there is no `Agent` tool or a child is silent at the bound. Ignore a late result. The full rule is `_shared/subagent-dispatch-core.md`'s Foreground Execution Discipline.
  4. Give any agent you dispatch this same instruction.
  Re-anchor the marker sentence: "if a turn ends anyway with a child still outstanding — the keep-alive rule's failure path — make that reply's last non-empty line `INTERIM_STATUS: …`".
- [ ] **Step 4: Rewrite both template paragraphs** identically. Keep the first two sentences, which carry both `REQUIRED` patterns. Replace "That same stall risk covers … not the stall this clause warns against." with: "A nested `Agent` call (a lens-dispatch fan-out, a reproduction pair) always launches async, and its completion notification reaches you only while this turn is alive: keep the turn alive with {PRIMITIVE} until every child has reported, and never end this turn with one child outstanding. With no `Agent` tool, or a child still silent when the bound expires, judge that unit yourself, log the downgrade, and mark its findings `unconfirmed`. A reply that ends without a tool call ends the turn." Use `--` dashes and hard wrapping at the templates' width, matching the surrounding fenced text.
- [ ] **Step 5: Rewrite the rationale paragraph (`:237-240`):** each template restates the nested-`Agent` rule because it is inlined verbatim into a `Task()` prompt whose agent never sees the core file. `_shared/subagent-dispatch-core.md`'s Foreground Execution Discipline is the one definition of the rule, its keep-alive bound and its `unconfirmed` fallback (#3078). `_shared/dispatch-waiting.md` describes a top-level dispatcher, not this agent.
- [ ] **Step 6: Run to see it pass.** Run: `node --test tests/foreground-execution-instruction.test.js tests/hooks-subagent-stop.test.js tests/dispatch-worktree-anchoring.test.js`. Expected: PASS, 0 fail.
- [ ] **Step 7: Commit** both files by explicit path.

### Task 5: Full suite (folded into `/build` Common Step 5)


Folded verification task (AC5.1, AC6.1): the orchestrator runs `npm test > {scratch}/npm-test.txt 2>&1` centrally, in the foreground. Pass means exit 0 and `fail 0`. Afterwards it appends a `### Deliverable 2 probe` section quoting `PROBE_COMMENT_URL` and the raw outcome to PR #3708's body.
