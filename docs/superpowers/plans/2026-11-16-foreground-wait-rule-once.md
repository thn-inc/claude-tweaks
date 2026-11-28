# Foreground-Wait Rule Once Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dispatched prompt states the foreground-wait rule once, through Context pack item 7, instead of twice.

**Architecture:** Item 7 of `plugin/skills/dispatch/task-prompt.md`'s Context pack gains the four facts only the template paragraph held. The four `Foreground execution (required):` paragraphs in the fenced templates of `task-prompt.md` and `express-prompt.md` are deleted; each template keeps its `{context-pack}` placeholder, which `renderTaskPrompt` (`plugin/bin/lib/dispatch/task-prompt.js`) fills from the Context pack with no code change. Tests move from per-template paragraph pins to assertions on prompts rendered through `renderTaskPrompt`.

**Tech Stack:** Markdown skill prose; `node --test` suites using `tests/helpers/read-skill.js` and `tests/helpers/conformance-asserts.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T004115-record-5601/work/5601-spec.md` (record #5601)

Scope keywords: Foreground execution clause, foreground-execution instruction, Foreground execution (required)

Scope sweep (Check B): `CHANGELOG.md`, `docs/superpowers/plans/2026-11-01-dispatch-prompt-cli-4589.md` and `docs/superpowers/plans/2026-11-08-cut-redundant-local-full-suite-runs.md` are append-only history, ruled out of scope.

## Global Constraints

- Item 7's addition is under 600 bytes (Deliverable 1).
- `task-prompt.md` ends at least 6,800 bytes smaller and `express-prompt.md` at least 7,400 bytes smaller than on the merge base — AC5. At planning the merge base is `47ece10bb` (52,492 and 17,617 bytes there): #4831, the one open record that removes the same `task-prompt.md` paragraphs, is still open (`gh issue view 4831`: OPEN, 2026-11-16), so the spec's "merge base" and `47ece10bb` are the same commit for this build. If #4831 lands before this branch merges, AC5's `task-prompt.md` bound and AC1's base counts are re-measured against the new merge base at review (plan review row 1, logged). `express-prompt.md` gains no text in this change.
- `renderTaskPrompt` gets no code change (spec Technical Approach).
- `tests/flow-context-handoff-conformance.test.js` gets no edit (AC4).
- Commit messages reference the record as `refs #5601`, never `closes`/`fixes`.
- Decision rule (spec, author 2026-11-16): where a choice is left open, take the reading that keeps a run on the previous plugin release working; puts the rule in code not prose; stays inside the record's Key Files. State the choice in the PR body.
- Governing project skill `.claude/skills/skill-prose-conformance-tests` (quoted verbatim):
  - "Write the assertion as a predicate that returns the facts whose pattern no longer matches (`missingFactsOf(patterns)`), and assert it returns `[]` on the live region. Then, per pattern, strip only that pattern's match from the live text and assert the same predicate returns exactly `[fact]`."
  - "A phrase that occurs twice in the region survives the one non-global `replace`, so the predicate reports `[]` and the proof goes red. That forces each pattern to match exactly once in its slice."
  - "Keep the patterns non-global"
  - "Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** … preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - "Hard-wrapped markdown splits phrases across lines, so a single-line literal match returns zero while the phrase is right there `[IL-66]`." — every new pattern uses `\s+` between words, or runs on whitespace-squashed text.
  - "Apply the whitespace-collapsed control scan to **both** directions of a migration suite — absence assertions need it more than presence ones."
  - "When the assertion and the prose it pins are authored in the same change … copy the pinned literal out of the edit's own replacement text, never from memory of what that edit says."
- `.claude/skills/parse-signal-discipline` and `.claude/skills/shared-contract-extraction`: no rule beyond the above applies — no parser or `_shared` file is created; the citation sweep is Task 2's grep.

## Review Focus

1. A wrapped line inside item 7 splitting a pinned phrase — patterns use `\s+` or run on squashed text (Task 1).
2. A future edit re-adding a Foreground paragraph to one template only — AC2's per-block assertion (Task 1).
3. The express path narrowed so `{context-pack}` no longer carries item 7 — AC8 pin (Task 1).
4. The handoff copy drifting from item 7 — existing word-for-word pin, re-run unchanged (Task 1).
5. A stale citation of "the Foreground execution clause" left in prose a dispatcher reads — AC6 grep (Task 2).

## Item 7 replacement text (used by Task 1, verbatim)

In `task-prompt.md` item 7, replace the sentence

```
Run a long
   command (e.g. the full test suite) as a normal foreground call with a large explicit timeout
   (#1965).
```

with

```
Always
   run the project's test command and every other long-running command in the foreground, as a
   normal call with a large explicit timeout and its output redirected to a file if it's long —
   never with `run_in_background` — and never end the turn waiting on a background run you
   started (#1965).
```

The handoff template's `Async-wait discipline (required):` paragraph in `plugin/skills/flow/context-handoff.md` replaces its identical sentence with the identical new text, so `squash(template)` contains item 7's squashed body again.

## Disposition list (PR body, Deliverable 2 / AC9 — written by the controller after Task 2, not an SDD task)

One line per sentence of the removed paragraph (base `47ece10bb`, `task-prompt.md` lines 154-192):

1. "run the project's test command and every other long-running command in the foreground of this turn, output redirected to a file if it's long -- never with `run_in_background`" — added to item 7.
2. "Never end this turn waiting on a background test run or fix-round you started this way -- you cannot count on being re-woken by either, and the run stalls silently when you are not (#1965)." — "never end the turn waiting on a background run you started" added to item 7; "cannot count on being re-woken" already in item 7 ("Once your turn ends you cannot count on being re-woken"); "the run stalls silently" dropped as restatement (rationale, no instruction).
3. "A nested `Agent` call (a lens-dispatch fan-out, a reproduction pair) launches async … never end this turn with one child outstanding." — already in item 7 ("A nested `Agent` call launches async … and never end your turn with one outstanding"); the two parenthetical examples dropped as restatement.
4. "With no `Agent` tool … your final reply still ends with its usual `STATUS:` line." — already in item 7 ("With no `Agent` tool … so your final reply still ends with `STATUS: {WORD}`").
5. "Ignore that child's result if it arrives later; if a late notification re-wakes you … would replace the report." — already in item 7 ("Ignore a late result; if a late notification re-wakes you after your final reply, repeat your whole final reply unchanged").
6. "A child that reports a failure … otherwise judge that unit yourself." — already in item 7 (same sentence).
7. "Self-judging is for a read-only unit … naming that child and its unit." — already in item 7 (same sentence).
8. "Before that stop, probe the worktree its prompt names, read-only … grants a window)." — already in item 7 (same words).
9. "Per wave, while any child shows a change … and every unchanged child." — already in item 7 (same words).
10. "Children sharing a worktree progress together; a child whose prompt names no worktree counts as unchanged." — already in item 7.
11. "A failed wait call counts as no wait but ends its window … never retried in another form." — already in item 7.
12. "Read-only units keep the first-bound self-judge." — already in item 7.
13. "Exception: a rendered-UI unit (review Step 6/6.5) … (`_shared/rendered-ui-units.md`)." — already in item 7.
14. "A wait call that is blocked or fails is not a wait … treat every child still outstanding as silent at the bound." — already in item 7.
15. "A reply that ends without a tool call ends the turn." — already in item 7 ("a reply that ends without a tool call ends your turn").

---

### Task 1: Item 7 carries the whole rule, and the four templates drop their copies

**Role:** integration
**Review risk:** high

One task, one commit (plan review, 2026-11-16): adding to item 7 alone would leave `task-prompt.md` above `RAIL_BYTES` (52,500) at a commit boundary, so the item-7 addition (Part A) and the paragraph removal (Part B) land together. Run Part A's Steps 1-3, then Part B's Steps 1-3, then the shared Steps 4-6 at the end.

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md` (item 7, lines 37-90; and delete the `Foreground execution (required):` paragraph and its trailing blank line in both fenced templates, lines 154-193 and 346-385)
- Modify: `plugin/skills/dispatch/express-prompt.md` (same deletion, lines 31-70 and 133-172)
- Modify: `plugin/skills/flow/context-handoff.md` (the `Async-wait discipline (required):` paragraph, lines 84-136)
- Create: `tests/fixtures/dispatch-prompt/foreground-paragraph-pre-5601.txt` — the base paragraph, verbatim, from `git show 47ece10bb:plugin/skills/dispatch/task-prompt.md` lines 154-192 (no trailing blank line)
- Test: `tests/foreground-execution-instruction.test.js`
- Test: `tests/pipeline-test-scope-conformance.test.js`
- Test: `tests/dispatch-express-routing-prose.test.js`
- Waived `tests/flow-context-handoff-conformance.test.js`: read-only — run in Step 4, never edited (AC4).
- Waived `plugin/bin/lib/dispatch/task-prompt.js`: read only — `renderTaskPrompt(text, { call, issues, runDir, pluginRoot, policyValues, selectedAt, effortLine })` is the API the new tests call (see `tests/bin-lib/dispatch/task-prompt.test.js` lines 21-32 for a valid opts object).

**Interfaces:**
- Produces: item 7 text matching `REQUIRED` (both patterns) and `PROJECT_TEST_CMD` once each; `REQUIRED` widened to `\s+` word gaps; a test-local `renderedCounts(prompt) -> { primitive, probe, runInBackground, projectTestCmd }` helper in `tests/foreground-execution-instruction.test.js`.

#### Part A — item 7 and the handoff template

- [ ] **Step A1: Write the failing tests**

In `tests/foreground-execution-instruction.test.js`:
- Change both `REQUIRED` patterns' literal spaces to `\s+` (`/never\s+with\s+`run_in_background`/i`, `/never\s+end\s+(?:this|the)\s+turn\s+waiting\s+on\s+a\s+background/i`); the build/dispatch.md test keeps using it.
- Spread `...REQUIRED` into `ITEM7`, and add `[/run\s+the\s+project's\s+test\s+command\s+and\s+every\s+other\s+long-running\s+command/, "item 7 names the project's test command"]` to `ITEM7`. The existing `'task-prompt item 7 drops "nothing wakes you"…'` test and `assertEachPatternGoesRed(item7Block(text), ITEM7, item7Missing)` then cover AC3.1-3.3 (each new pattern present and matching exactly once, with its go-red proof). Rename that go-red test to cite `AC3.1 AC3.2 AC3.3`.
- New test `'AC3: REQUIRED holds on the handoff template paragraph'`: `assert.deepEqual(missingFactsOf(REQUIRED)(handoffWaitParagraph(readText(HANDOFF))), [])`, plus `assertEachPatternGoesRed(handoffWaitParagraph(...), REQUIRED, missingFactsOf(REQUIRED))`.

In `tests/pipeline-test-scope-conformance.test.js`, add after the `PROJECT_TEST_CMD` constant:
- A local `item7` slice (`'7. **Async-wait discipline**'` to the next `\n8. ` — assert both anchors resolve), whitespace-squashed.
- Test `"AC3.3: task-prompt.md item 7 names the project's test command exactly once (#5601)"`: `assert.equal(squashedItem7.split(PROJECT_TEST_CMD).length - 1, 1)`.
- Go-red test: strip that one occurrence (`squashedItem7.replace(PROJECT_TEST_CMD, '')`), `assert.notEqual` it, and assert the count helper returns 0.

- [ ] **Step A2: Run the tests to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js tests/pipeline-test-scope-conformance.test.js`
Expected: FAIL — item 7 lacks `run_in_background`, "never end the turn waiting on a background" and the project's test command; the handoff paragraph lacks the REQUIRED facts.

- [ ] **Step A3: Edit item 7 and the handoff paragraph**

Apply "Item 7 replacement text" above to `task-prompt.md` item 7, and the identical replacement to `context-handoff.md`'s paragraph. Keep the hard-wrap style of the surrounding lines; change nothing else in item 7 or the handoff file.

#### Part B — remove the four template paragraphs; assert on rendered prompts

- [ ] **Step B1: Write the failing tests**

`tests/foreground-execution-instruction.test.js`:
- Delete `TEMPLATE_KEEP_ALIVE`, `templateKeepAliveMissing`, `foregroundParagraph`, the test `'task-prompt.md: both fenced Task-prompt templates carry the foreground-execution instruction'`, and the test `'the foreground-instruction predicate can actually go red (discrimination proof)'`. In `'neither fenced template keeps the in-turn carve-out (#3078)'` keep only the `dropsInTurnCarveOut` assertion; in `'each task-prompt assertion can actually go red…'` drop the template loop.
- `primitiveCopies()` returns three entries: `'subagent-dispatch-core.md'`, `'task-prompt.md item 7'`, `'context-handoff.md template'`. Update comments that say "seven copies" to "three copies".
- New, with `const { renderTaskPrompt } = require('../plugin/bin/lib/dispatch/task-prompt')` and an opts object like `task-prompt.test.js`'s:
  - `renderedCounts(prompt)`: whitespace-squash, then count non-overlapping matches of the primitive (`PRIMITIVE` source, made global locally), `probe the worktree its prompt names, read-only`, `` `run_in_background` ``, and `the project's test command`.
  - Test `'AC1.1 AC1.2: a rendered first-call and second-call prompt state the wait rule once (#5601)'`: for `call` in `['first', 'second']`, assert `primitive === 1`, `probe === 1`, `runInBackground >= 1`, `projectTestCmd >= 1`.
  - Go-red test `'AC1.1: the rendered-count check goes red with a template paragraph restored'`: read the fixture, insert `fixture + '\n\n'` immediately before the first `{context-pack}` line of each fenced template in an in-memory copy of `task-prompt.md` (`assert.notEqual` on the copy), render both calls, and assert `primitive === 2` and `probe === 2` — the base-commit counts AC1 names.
  - Test `'AC2.1 AC2.2: no fenced template holds a Foreground paragraph; each holds {context-pack} once (#5601)'`: over `fencedBlocks` of `task-prompt.md` (2 blocks) and `express-prompt.md` (2 blocks), a predicate `templateDefects(blocks)` returns the labels of blocks that contain a paragraph starting `Foreground execution (required):` or whose `{context-pack}` count is not 1; assert `[]`.
  - Go-red: (a) the fixture inserted into one block reports exactly that block; (b) a block with `{context-pack}` duplicated reports exactly that block. Each preceded by `assert.notEqual`.

`tests/pipeline-test-scope-conformance.test.js`:
- `"every dispatch prompt Foreground paragraph names the project's test command (#5117)"` becomes `"AC2.1: neither dispatch prompt file holds a Foreground paragraph (#5601)"`: `assert.equal(foregroundParagraphs(file).length, 0)` for both files.
- New `"AC1.4: both rendered prompts carry item 7's project-test-command sentence (#5601)"`: render `first` and `second` via `renderTaskPrompt`, squash whitespace, `assert.match(squashed, PROJECT_TEST_CMD)`.
- Keep `'the Foreground project-test-command fact can go red (#5117)'` unchanged (it runs against the frozen `PRE_CHANGE_FOREGROUND`).

`tests/dispatch-express-routing-prose.test.js`:
- Delete `"both templates restate the first call's Foreground execution paragraph verbatim"` and the `FOREGROUND` half of `'go-red control: a reworded copied paragraph fails, a rewrapped one does not'` (keep its `WORKDIR`/`NO_STASH` loop). Update the header comment (lines 7-9) to stop claiming a copied Foreground paragraph.
- New `'AC2: each express template holds {context-pack} once and no Foreground paragraph (#5601)'`, with go-red controls as in the AC2 test above (fixture inserted; placeholder duplicated).
- New `'AC8.1: express-prompt.md defines {context-pack} as the whole Context pack section (#5601)'`: `assert.match(squash(lineThree), /`\{context-pack\}` is `task-prompt\.md`'s Context pack section, each numbered item resolved as it states/)` where `lineThree` is the line starting `Referenced by`.
- Go-red `'AC8.2: narrowing the definition to a list without item 7 goes red'`: replace `Context pack section, each numbered item resolved as it states` with `Context pack items 1-6 and 8, each resolved as it states` in memory, `assert.notEqual`, and assert the same check fails (`assert.throws` matched to its message).

- [ ] **Step B2: Run the tests to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js tests/pipeline-test-scope-conformance.test.js tests/dispatch-express-routing-prose.test.js`
Expected: FAIL — rendered counts are 2, the paragraphs are still present, Foreground paragraph count is 2. (AC8.1 passes before the edit: it pins existing text.)

- [ ] **Step B3: Delete the four paragraphs**

Remove each `Foreground execution (required):` paragraph plus one adjacent blank line, so `{context-pack}` is preceded by exactly one blank line. Touch nothing else.

#### Shared closing steps

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/foreground-execution-instruction.test.js tests/pipeline-test-scope-conformance.test.js tests/dispatch-express-routing-prose.test.js tests/bin-lib/dispatch/task-prompt.test.js tests/hooks-dispatch-prompt-gate.test.js tests/flow-context-handoff-conformance.test.js tests/review-dispatched-reviewer-degrade-conformance.test.js`
Expected: PASS (AC4.1 with no edit to the handoff conformance test; AC10.1, AC10.2 included).

- [ ] **Step 5: Check sizes (AC5)**

Run: `wc -c plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md`
Expected: at most 45,692 and 10,217 (merge base `47ece10bb` sizes minus 6,800 and 7,400). The controller records the measurement as an `AC evidence` decision with its output under `$PIPELINE_RUN_DIR/evidence/ac5-sizes.txt` (plan-authoring-checks' AC-evidence persistence check); the measurement stays scratch.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md plugin/skills/flow/context-handoff.md tests/fixtures/dispatch-prompt/foreground-paragraph-pre-5601.txt tests/foreground-execution-instruction.test.js tests/pipeline-test-scope-conformance.test.js tests/dispatch-express-routing-prose.test.js
git commit -m "State the foreground rule once, in Context pack item 7 — refs #5601"
```

### Task 2: Re-point every citation of the removed clause

**Role:** integration

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md` (the three paragraphs after the first-call template, lines ~269-284 after Task 1)
- Modify: `plugin/skills/_shared/rendered-ui-units.md` (line 3: "its six inlined copies" → "its two inlined copies (`dispatch/task-prompt.md`'s Context pack item 7 and `flow/context-handoff.md`'s template)" — plan review, Deliverable 5)
- Modify: `plugin/skills/dispatch/sequential-execution.md` (lines 54, 68-70)
- Modify: `plugin/skills/dispatch/two-call-gate.md` (line 61)
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (line 63)
- Modify: `plugin/skills/flow/multispec-parallel-waves.md` (line 86's `{context-pack}` sentence)
- Modify: `docs/skill-graph.md` (line 271, the `_shared/subagent-dispatch-core.md` row)
- Modify: `docs/plugin-structure.md` (line 142, "the Foreground execution clause forbids")
- Modify: `docs/journeys/run-parallel-pipelines-without-per-task-full-suites-5117.md` (lines 52-53, which describe the Foreground paragraph as current)
- Modify: `.claude/skills/skill-prose-conformance-tests/SKILL.md` (line 63: "`task-prompt.md`'s item 7 and both fenced templates" → "`task-prompt.md`'s item 7 and the handoff template" — same byte length; the file is at 52,495 bytes)
- Test: `tests/dispatch-heartbeat-visibility.test.js` (lines 26, 40, 43)
- Modify: `tests/dispatch-mechanical-enforcement.test.js` (header comment line 10 only)
- Test: `tests/foreground-execution-instruction.test.js` (AC7 test)

**Interfaces:**
- Consumes: Task 1's final `task-prompt.md` and item 7.

Replacement wording (copy these literals into prose and tests):
- `task-prompt.md`: "The Foreground execution clause above is backed by" → "Context pack item 7 is backed by"; "never a reason to relax the Foreground execution clause above or have this call check in mid-turn" → "never a reason to relax Context pack item 7 or have this call check in mid-turn"; the #2533 paragraph becomes: "Context pack item 7 carries the nested-`Agent` rule (#2533, reworked in #3078) into each template through its `{context-pack}` placeholder, because each template is inlined verbatim into a `Task()` prompt whose agent never sees the core file. `_shared/subagent-dispatch-core.md`'s Foreground Execution Discipline is the one definition of that rule, its keep-alive bound and its `unconfirmed` fallback. `_shared/dispatch-waiting.md` describes a top-level dispatcher waiting on its own children, not this agent, so it is not the basis for item 7." (Keeps `RATIONALE`'s citation and `dropsPrimaryResumeSignal`.)
- `sequential-execution.md` 54: "yielded outside the Foreground execution clause (`task-prompt.md`; #1965)" → "yielded outside `task-prompt.md`'s Context pack item 7 (#1965)"; 68-70: "the exact stall hazard the Foreground execution clause\n(`task-prompt.md`) exists to prevent" → "the exact stall hazard `task-prompt.md`'s Context pack item 7\nexists to prevent".
- `two-call-gate.md` 61: "yielded outside the Foreground execution clause" → "yielded outside `task-prompt.md`'s Context pack item 7".
- `subagent-dispatch-core.md` 63: "`dispatch/task-prompt.md`'s foreground-execution instruction are" → "`dispatch/task-prompt.md`'s Context pack item 7 are".
- `multispec-parallel-waves.md` 86: "`{context-pack}` is `dispatch/task-prompt.md`'s Context pack items 1 (the literal plugin root), 6 (the worktree shell constraint) and 7 (async-wait discipline, with its `INTERIM_STATUS` rule), all copied verbatim, with item 1 resolved to this session's own plugin root."
- `docs/skill-graph.md` row: state that item 7 restates the core rule; every dispatch template (`task-prompt.md`'s two, `express-prompt.md`'s two) carries it only through `{context-pack}`, so a dispatched prompt states it once (#5601); `multispec-parallel-waves.md` inlines items 1, 6 and 7; `context-handoff.md` inlines item 7; `tests/foreground-execution-instruction.test.js` pins three copies: the core section, item 7, and the handoff template, and asserts the once-per-prompt count on prompts rendered by `renderTaskPrompt`. Keep the row's #3078/#4557/#5280 rule summary.
- `docs/plugin-structure.md` 142: "a mid-turn check-in the Foreground execution clause forbids" → "a mid-turn check-in `task-prompt.md`'s Context pack item 7 forbids".
- Journey lines 52-53: the rule reaches each dispatch prompt once, through item 7, which names the project's test command; the red flag becomes a dispatch template carrying its own copy of the wait rule.

- [ ] **Step 1: Write the failing tests**

`tests/dispatch-heartbeat-visibility.test.js`: line 26 → `/recreating the exact stall hazard\s+`task-prompt\.md`'s\s+Context pack item 7/`; line 43 → `/never a\s+reason to relax Context pack item 7\s+or have this call check in mid-turn/`; retitle line 40's test "…beside Context pack item 7 it must not conflict with".

`tests/foreground-execution-instruction.test.js`: test `'AC7.1: multispec-parallel-waves.md inlines items 1, 6 and 7 and no template clause (#5601)'` — slice the paragraph starting `Inline the block below verbatim` (blank-line split, exactly one), squash, and a predicate `multispecPackGaps(p)` returns `['names items 1, 6 and 7']` when `/`\{context-pack\}` is `dispatch\/task-prompt\.md`'s Context pack items 1 \(the literal plugin root\), 6 \(the worktree shell constraint\) and 7 \(async-wait discipline, with its `INTERIM_STATUS` rule\)/` fails and `['no template clause']` when `/template's Foreground execution clause/i` matches; assert `[]`. Go-red: append ", plus that file's `build,test` template's Foreground execution clause" in memory → exactly `['no template clause']`; strip "and 7 (async-wait discipline, with its `INTERIM_STATUS` rule)" → exactly `['names items 1, 6 and 7']`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/dispatch-heartbeat-visibility.test.js tests/foreground-execution-instruction.test.js`
Expected: FAIL on the two heartbeat regexes and AC7.1.

- [ ] **Step 3: Apply the replacement wording** to every file listed above, and update `tests/dispatch-mechanical-enforcement.test.js` line 10's comment to "task-prompt.md's foreground rule (Context pack item 7)".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/dispatch-heartbeat-visibility.test.js tests/foreground-execution-instruction.test.js tests/dispatch-mechanical-enforcement.test.js tests/dispatch-express-routing-prose.test.js tests/pipeline-test-scope-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: AC6 retirement sweep**

Run: `git grep -n -F "Foreground execution clause" -- plugin docs/skill-graph.md` — expected: no output (control: 8 lines at `47ece10bb`, verified at authoring: docs/skill-graph.md 1, sequential-execution.md 2, task-prompt.md 3, two-call-gate.md 1, multispec-parallel-waves.md 1).
Run: `git grep -n -F "foreground-execution instruction" -- plugin` — expected: no output (control: 1 line, subagent-dispatch-core.md).
Run: `git grep -n -i -e "Foreground execution clause" -e "Foreground execution (required)" -e "foreground-execution instruction" -- plugin docs .claude/skills ':!docs/superpowers/plans' ':!docs/plans'` — expected: only historical lines (none in `plugin/`); list any hit outside `plugin/` in the commit body with its verdict.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/sequential-execution.md plugin/skills/dispatch/two-call-gate.md plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/flow/multispec-parallel-waves.md docs/skill-graph.md docs/plugin-structure.md docs/journeys/run-parallel-pipelines-without-per-task-full-suites-5117.md plugin/skills/_shared/rendered-ui-units.md .claude/skills/skill-prose-conformance-tests/SKILL.md tests/dispatch-heartbeat-visibility.test.js tests/dispatch-mechanical-enforcement.test.js tests/foreground-execution-instruction.test.js
git commit -m "Cite Context pack item 7 where prose named the template clause — refs #5601"
```

## AC coverage map

| AC | Covered by |
|---|---|
| AC1.1, AC1.2, AC1.3, AC1.4 | Task 1 rendered-count tests (AC1.3: the once-per-prompt invariant is that test's assertion); AC1.4 also Task 1 pipeline-test-scope test |
| AC2.1, AC2.2 | Task 1 template-defects test |
| AC3.1, AC3.2 | Task 1 Part A ITEM7 extension + go-red (exactly-once via `assertEachPatternGoesRed`) |
| AC4.1 | Task 1 Step 4 (no edit) |
| AC5.1, AC5.2, AC5.3 | Task 1 Step 5 (scratch measurement against the merge base, logged as AC evidence) |
| AC6.1, AC6.2 | Task 2 Step 5 |
| AC7.1, AC7.2 | Task 2 AC7.1 test |
| AC8.1 | Task 1 express tests (pin + narrowing go-red) |
| AC9.1 | Controller: disposition list appended to the PR body |
| AC10.1 | Task 1 Step 4 |
| AC11.1 | Common Step 5 / `/claude-tweaks:test` full run |
