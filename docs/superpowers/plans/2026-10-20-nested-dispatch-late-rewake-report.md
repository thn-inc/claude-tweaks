# Nested-dispatch late re-wake report loss — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a late re-wake from replacing a dispatched agent's final report with a bare `STATUS:` line. Also record why an abandoned nested child delays delivery, and qualify every "never re-woken" claim to what was measured.

**Architecture:** This is a prose-only contract change across the four copies of the nested-children rule (`_shared/subagent-dispatch-core.md` and three copies in `dispatch/task-prompt.md`) and one SDD restatement (`build/dispatch.md`). The conformance suite `tests/foreground-execution-instruction.test.js` pins each fact per copy and proves every pin can go red. The `sleep 20` keep-alive primitive is untouched.

**Tech Stack:** Markdown skill prose; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124816-spec-3722/work/3722-spec.md` (record #3722). Probe evidence: https://github.com/thn-inc/claude-tweaks/issues/3722#issuecomment-6294932708

**Scope keywords:** re-woken, re-wakes, final `STATUS:` line

## Global Constraints

- Keep `` `sleep 20` Bash calls, at most 60 (20 minutes) per wave of children `` byte-identical in all four copies. `EXPECTED_PRIMITIVE` stays `'20/60/20'`.
- Each copy hard-wraps at ~100 columns, matching its neighbors. Core and item 7 use `—`; the fenced templates use `--`.
- Commit subjects use `{Verb} {what} — {detail}`, reference `refs #3722` (never `closes`/`fixes`), and end with the trailer `Claude-Session: https://claude.ai/code/session_01FEgjLxGeFCCweePJNNPwD1`.
- Every new pattern matches **exactly once** in each copy it is spread over, so its go-red proof removes the only occurrence.

## Review Focus

- A copy left on the old STATUS-only wording. Task 1's absence check runs over all four copies, with a per-copy go-red.
- A re-wrapped sentence that splits a pattern across lines. Every pattern uses `\s+`.
- A sixth restatement of "never re-woken" elsewhere. The pre-plan sweep found only the five sites in Task 2, and Task 2's absence check covers all five.
- The new core sentences duplicating a phrase another SHARED_RULE pattern counts. Each pattern appears exactly once per copy; Tasks 1 and 2 keep the existing go-red loop.
- The template text "final reply still ends with its usual `STATUS:` line" must still match its SHARED_RULE pattern, and must not match the new STATUS-only absence pattern. This was checked against the planned text.

---

### Task 1: A late re-wake repeats the whole final reply; the core records the abandoned-child facts

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (Foreground Execution Discipline, nested-children paragraph: the "A child whose unit was self-judged at the bound is abandoned" and "A child result that arrives after" sentences)
- Modify: `plugin/skills/dispatch/task-prompt.md` (item 7's "Ignore a late result" sentence; both fenced templates' "Ignore that child's result if it arrives later" sentence)
- Test: `tests/foreground-execution-instruction.test.js`

**Interfaces:**
- Produces: `STATUS_ONLY` regex and the `repeatsStatusOnlyCopies(copies)` predicate, reused by nothing outside this file; `CORE_ABANDONED` pattern list.
- Consumes: the existing `primitiveCopies()`, `coreForegroundSection()`, `missingFactsOf()` and `assertEachPatternGoesRed()`.

- [ ] **Step 1: Write the failing tests** (covers AC1.1, AC1.2, AC2.1; AC4.1 is held by the unchanged primitive-agreement tests, which this step leaves in place)

In `SHARED_RULE`, replace the late-re-wake entry with these two entries:

```js
[/re-wakes\s+(?:you|the\s+agent)\s+after\s+(?:your|its)\s+final\s+reply[^.]*?\brepeat(?:ing)?\s+(?:its|your)\s+whole\s+final\s+reply\s+unchanged/, 'a late re-wake after the final reply repeats the whole final reply unchanged'],
[/dispatcher\s+keeps\s+only\s+(?:the\s+agent's|your)\s+latest\s+reply/, 'the reason: the dispatcher keeps only the latest reply'],
```

After the primitive-agreement tests, add:

```js
// #3722: the dispatcher keeps only the latest reply, so a re-wake answered with the bare STATUS line
// replaced the report. No copy may keep the STATUS-only wording.
const STATUS_ONLY = /repeat(?:ing)?\s+that\s+final\s+`STATUS:`\s+line/;
const repeatsStatusOnlyCopies = (copies) => Object.entries(copies).filter(([, t]) => STATUS_ONLY.test(t)).map(([n]) => n);
test('no copy answers a late re-wake with the STATUS line alone (#3722)', ...)        // deepEqual(repeatsStatusOnlyCopies(primitiveCopies()), [])
test('a copy reverting to the STATUS-only wording goes red (discrimination proof)', ...) // per copy: append ' repeat that final `STATUS:` line unchanged.' → result is exactly [name]

const CORE_ABANDONED = [
  [/abandoned\s+child\s+cannot\s+be\s+stopped/, 'an abandoned child cannot be stopped'],
  [/`TaskStop`\s+refuses\s+a\s+nested\s+child/, 'TaskStop refuses a nested child'],
  [/hold\s+the\s+agent's\s+final\s+result\s+until\s+it\s+finishes/, "the harness may hold the agent's final result until the child finishes"],
  [/bound\s+caps\s+the\s+wait,\s+not\s+the\s+delivery/, 'the bound caps the wait, not the delivery'],
];
const coreAbandonedMissing = missingFactsOf(CORE_ABANDONED);
test('the core section records that an abandoned nested child cannot be stopped and may delay the final result (#3722)', ...)
test('each core abandoned-child assertion can actually go red on its own (discrimination proof)', ...) // assertEachPatternGoesRed(coreForegroundSection(core), CORE_ABANDONED, coreAbandonedMissing)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: FAIL after Step 1. All four copies miss the new SHARED_RULE facts, all four match `STATUS_ONLY`, and the core misses all four `CORE_ABANDONED` facts.

- [ ] **Step 3: Rewrite the prose**

Core. Replace the clause "a late notification that re-wakes the agent after its final reply is answered by repeating that final `STATUS:` line unchanged." with:

"a late notification that re-wakes the agent after its final reply is answered by repeating its whole final reply unchanged: the dispatcher keeps only the agent's latest reply, so a bare `STATUS:` line would replace the report (#3722)."

Then insert this sentence immediately before "A child result that arrives after its unit was self-judged":

"An abandoned child cannot be stopped (`TaskStop` refuses a nested child: it is owned by the child itself), so it keeps running, and the harness may hold the agent's final result until it finishes: the bound caps the wait, not the delivery."

Item 7. Replace "repeat that final `STATUS:` line unchanged." with:

"repeat your whole final reply unchanged — the dispatcher keeps only your latest reply, so a bare `STATUS:` line would replace the report."

Both templates. Replace "repeat that final `STATUS:` line unchanged." with:

"repeat your whole final reply unchanged -- the dispatcher keeps only your latest reply, so a bare `STATUS:` line would replace the report."

Re-wrap each edited paragraph to its neighbors' width.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: PASS, including the unchanged primitive-agreement tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/dispatch/task-prompt.md tests/foreground-execution-instruction.test.js
git commit -m "Repeat the whole final reply on a late re-wake — a bare STATUS line replaced the report (refs #3722)" -m "Claude-Session: https://claude.ai/code/session_01FEgjLxGeFCCweePJNNPwD1"
```

### Task 2: Qualify every never-re-woken claim; the core carries the measured facts

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (the "**Background work.**" paragraph's first sentence; the Bounded polling paragraph's "(nothing ever re-wakes a dispatched agent)")
- Modify: `plugin/skills/dispatch/task-prompt.md` (item 7's "Once your turn ends nothing re-wakes you"; both templates' "there is no notification mechanism behind either, so it is never re-woken and the run stalls silently (#1965)")
- Modify: `plugin/skills/build/dispatch.md` (line 14: "a dispatched agent that yields this way is never re-woken and the run stalls silently")
- Test: `tests/foreground-execution-instruction.test.js`

**Interfaces:**
- Consumes: Task 1's file state, plus `primitiveCopies()`, `BUILD_DISPATCH`, `coreForegroundSection()`, `missingFactsOf()` and `assertEachPatternGoesRed()`.
- Produces: `UNQUALIFIED` regex and the `unqualifiedClaimSites()` predicate; the `CORE_MEASURED` pattern list.

- [ ] **Step 1: Write the failing tests** (covers AC3.1, AC3.2)

```js
// #3722: interactive 2.1.302 re-wakes a dispatched agent; what holds everywhere is "cannot count on it".
const UNQUALIFIED = /never\s+(?:be\s+)?re-woken|nothing\s+(?:ever\s+)?re-wakes|no\s+notification\s+mechanism/i;
const claimSites = () => ({ ...primitiveCopies(), 'build/dispatch.md': fs.readFileSync(BUILD_DISPATCH, 'utf8') });
const unqualifiedClaimSites = (sites) => Object.entries(sites).filter(([, t]) => UNQUALIFIED.test(t)).map(([n]) => n);
test('no copy states the never-re-woken claim unqualified (#3722)', ...)               // deepEqual(unqualifiedClaimSites(claimSites()), [])
test('an unqualified never-re-woken claim in any one copy goes red (discrimination proof)', ...) // per site: append ' It is never re-woken.' → exactly [name]

const CORE_MEASURED = [
  [/cannot\s+count\s+on\s+being\s+re-woken\s+once\s+its\s+turn\s+ends/, 'the Background work claim is qualified'],
  [/Measured\s+on\s+Claude\s+Code\s+\(#3722\)/, 'the measured facts cite #3722'],
  [/interactive\s+2\.1\.302\s+holds\s+it\s+open/, 'interactive 2.1.302 holds the agent open'],
  [/headless\s+\(`claude\s+-p`\)\s+2\.1\.299\s+and\s+older\s+never\s+re-wake\s+it/, 'headless 2.1.299 and older never re-wake it'],
  [/headless\s+2\.1\.302\s+and\s+later\s+runs\s+a\s+nested\s+`Agent`\s+call\s+synchronously/, 'headless 2.1.302+ runs nested Agent calls synchronously'],
];
const coreMeasuredMissing = missingFactsOf(CORE_MEASURED);
test('the core Background work paragraph names the measured re-wake facts (#3722)', ...)
test('each core measured-fact assertion can actually go red on its own (discrimination proof)', ...) // assertEachPatternGoesRed(coreForegroundSection(core), CORE_MEASURED, coreMeasuredMissing)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: FAIL after Step 1. All five sites match `UNQUALIFIED`, and the core misses all five `CORE_MEASURED` facts.

- [ ] **Step 3: Rewrite the prose**

Core Background work. Replace "A dispatched agent is never re-woken once its turn ends, so a backgrounded `Bash` call or `Monitor` watch it ends on hangs it until an outside caller intervenes." with:

"A dispatched agent cannot count on being re-woken once its turn ends. Measured on Claude Code (#3722): interactive 2.1.302 holds it open and re-wakes it when a nested child or `Monitor` watch it started reports; headless (`claude -p`) 2.1.299 and older never re-wake it, and the result goes to the top-level session instead; headless 2.1.302 and later runs a nested `Agent` call synchronously. So a backgrounded `Bash` call or `Monitor` watch it ends on can hang it until an outside caller intervenes."

Core Bounded polling. Replace "(nothing ever re-wakes a dispatched agent)" with "(a dispatched agent cannot count on being re-woken)".

Item 7. Replace "Once your turn ends nothing re-wakes you:" with "Once your turn ends you cannot count on being re-woken:".

Both templates. Replace "there is no notification mechanism behind either, so it is never re-woken and the run stalls silently (#1965)." with "you cannot count on being re-woken by either, and the run stalls silently when you are not (#1965)."

`build/dispatch.md`. Replace "a dispatched agent that yields this way is never re-woken and the run stalls silently." with "a dispatched agent that yields this way cannot count on being re-woken, and the run stalls silently when it is not."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: PASS. That includes `REQUIRED`'s "never end the turn waiting on a background" pin in both templates and `build/dispatch.md`, and item 7's `dropsNothingWakes`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/dispatch/task-prompt.md plugin/skills/build/dispatch.md tests/foreground-execution-instruction.test.js
git commit -m "Qualify the never-re-woken claims — interactive 2.1.302 re-wakes a dispatched agent (refs #3722)" -m "Claude-Session: https://claude.ai/code/session_01FEgjLxGeFCCweePJNNPwD1"
```

### Task 3: Full-suite verification

Folded into build Common Step 5. This task makes no edits.

**Files:**
- Test: `tests/` (full suite)

- [ ] **Step 1: Confirm the targeted suite is green** (re-verifies AC4.1: the primitive-agreement test still passes)

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: PASS

- [ ] **Step 2: Run the full suite**

Run: `npm test > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/f6bd1c7d-e245-447d-97d7-22617b3b6131/scratchpad/probe3722/npm-test.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`. Any byte- or size-pinned prose test touching the edited files passes.
