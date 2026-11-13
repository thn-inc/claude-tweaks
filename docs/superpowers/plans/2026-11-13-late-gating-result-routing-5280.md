# Late Rendered-UI Result Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A review Step 6 (visual-review) or Step 6.5 (design-wrapper review) nested agent gets #4557's progress-based extra wait windows, keyed on its screenshot directory, and a result it returns after being abandoned is staged for the Review Console instead of ignored.

**Architecture:** Prose contract change. `_shared/subagent-dispatch-core.md`'s Foreground Execution Discipline section gains one bold paragraph defining a *rendered-UI unit*, plus one restatement sentence. The same restatement sentence goes, word for word, into the six other copies of the nested-`Agent` wait rule (task-prompt item 7 and both templates, both express-prompt templates, the context-handoff template). The staged id reuses the existing `visual-review-` prefix (mapped to Pending review in `plugin/bin/lib/console/resolve.js`), so no code changes. Tests are prose pins in `tests/foreground-execution-instruction.test.js` plus one `stage-item.js` CLI test for the archived-run refusal.

**Tech Stack:** Markdown skill prose; Node 18+ `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T003014-spec-5280/work/5280-spec.md`

## Global Constraints

- Read-limit rail: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). On this branch `plugin/skills/dispatch/task-prompt.md` is 51,966 B (534 B headroom). The restatement sentence below is 132 B + 1 B of wrap, so the file lands at about 52,365 B (135 B headroom). Measure with `wc -c` after Task 2; it must be ≤ 52,500.
- `plugin/skills/review/code-mode-steps.md` (52,429 B, 71 B headroom) is **not edited**: the shared file names review Steps 6/6.5.
- The restatement sentence is identical in all seven copies (the #4557 "one passage, the same words in all seven copies" convention, `tests/foreground-execution-instruction.test.js` ~line 517). Exact text:
  `A rendered-UI unit (review Step 6/6.5) gets those windows while its named artifact directory changes, and its late result is staged.`
- Staged id: `visual-review-late-1` passed with `--allocate` (a `{kind}-{n}` shape, so collisions reallocate). The prefix is already in `CANONICAL_PREFIXES` / `SECTION_MAP` → Pending review.
- Existing pins must keep passing unchanged: `Read-only units keep the first-bound self-judge`, `Ignore a late result`, `Ignore that child's result if it arrives later`, `arrives after its unit was self-judged is ignored; it never changes a verdict` (lenses and judges keep that rule).
- Commit subject style: `{Verb} {what} — {detail}`; end each commit message with `Claude-Session: https://claude.ai/code/session_01X7gPFArDmEPR7zpw7iDxZE`. Use `refs #5280`, never `closes`.

## Review Focus

1. A rendered-UI unit whose prompt names no artifact directory: it counts as unchanged, so it is self-judged at the first bound exactly as today. Pinned by Task 1's core fact `names no artifact directory counts as unchanged`.
2. The artifact directory is missing or the `ls -lR` probe fails: no change, so no extension and the probe is never retried in another form. Pinned by Task 1's core fact.
3. A late result arriving after the run dir was archived: `stage-item.js` exits 3 and recreates nothing, and the findings go in the reply. Pinned by Task 1's CLI test plus the core fact.
4. Two late results in one run: `--allocate` reallocates instead of clobbering. Already covered by `tests/bin-lib/stage-item/cli.test.js`'s `--allocate` collision test; Task 1's twin pin asserts the core command carries `--allocate`.
5. A lens or judge unit: unaffected. No extension, late result still ignored. Pinned by the existing `KEEP_ALIVE` / `ITEM7` / `TEMPLATE_KEEP_ALIVE` / `PROGRESS_CHECK` arrays, which must stay green.

---

### Task 1: Rendered-UI unit rule in the shared contract

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (Foreground Execution Discipline section: after the sentence `Read-only units keep the first-bound self-judge.` at ~line 108, and a new bold paragraph immediately before `**Top-level dispatchers.**` at ~line 115)
- Test: `tests/foreground-execution-instruction.test.js` (append)
- Test: `tests/bin-lib/stage-item/cli.test.js` (append)

**Interfaces:**
- Produces: the restatement sentence (Global Constraints) inside `coreForegroundSection(readText(CORE))`, and a paragraph starting with the literal `**Rendered-UI units (#5280).**`. Task 2 adds the same sentence to the other six copies.

- [ ] **Step 1: Write the failing tests**

In `tests/foreground-execution-instruction.test.js`, append a `CORE_RENDERED_UI` array of `[regex, fact]` pairs matched against `coreForegroundSection(readText(CORE))`, each pattern matching exactly once (use `\s+` between words so line wraps pass):
- `/\*\*Rendered-UI\s+units\s+\(#5280\)\.\*\*/`: the paragraph exists (AC1.1)
- `/review\s+Step\s+6\s+\(visual-review\)\s+and\s+Step\s+6\.5\s+\(design-wrapper\s+review\)/`: names the two units (AC5.1)
- `/`\.claude-tweaks\/artifacts\/screenshots\/browse\/\{session\}\/`/` and `/`\.impeccable\/review\/`/`: the artifact directories the dispatcher names in the child's prompt (AC1.1)
- `/`ls\s+-lR\s+"\{artifact-dir\}"`\s+piped\s+to\s+`git\s+hash-object\s+--stdin`/`: the read-only probe (AC1.1)
- `/a\s+missing\s+directory\s+or\s+failed\s+probe\s+counts\s+as\s+no\s+change/`: Review Focus 2
- `/names\s+no\s+artifact\s+directory\s+counts\s+as\s+unchanged/`: Review Focus 1
- `/ceiling\s+of\s+3\s+windows\s+\(60\s+minutes\)/`, which must match once *inside the new paragraph*, so slice from `**Rendered-UI units` to `**Top-level dispatchers.**` for this array and assert against that slice instead of the whole section (AC1.1)
- `/never\s+satisfies\s+the\s+rendered-UI\s+check\s+before\s+merge/` and `/explicit\s+decline/` (AC5.1)
- `/stage-item\.js"\s+--run\s+"\{run-dir\}"\s+--id\s+visual-review-late-1\s+--allocate/` (AC3.1)
- `/STAGED\s+\{time\}\s+—\s+late\s+rendered-UI\s+result/`: the mandated decision line (AC3.1)
- `/exits\s+3[^.]*?write\s+nothing\s+under\s+the\s+run\s+dir[^.]*?name\s+the\s+findings\s+in\s+your\s+reply/` (AC4.1)
- `/never\s+changes\s+a\s+verdict\s+already\s+reached/` (AC1.2 / spec Deliverable 2)

Tests:
- `test('AC1.1 AC3.1 AC4.1 AC5.1: the core section defines rendered-UI units (#5280)', …)`: `missingFactsOf(CORE_RENDERED_UI)(slice)` deep-equals `[]`.
- `test('AC1.1: each rendered-UI core assertion goes red on its own (discrimination proof)', …)`: `assertEachPatternGoesRed(slice, CORE_RENDERED_UI, missing)`.
- `test('AC3.1: the core rendered-UI stage-item id classifies to a mapped console section (#5280)', …)`: extract the id with `/--id\s+(\S+)/` from the slice and assert `classifyStagedItem(id + '.md', '')` has `section === SECTIONS.PENDING` (import `SECTIONS` too) and `reason !== 'unmapped-prefix'`. Go-red control in the same test: `classifyStagedItem('rendered-late-1.md', '').reason === 'unmapped-prefix'`.
- `test('AC1.1: the core section states the rendered-UI restatement sentence once', …)`: the Global Constraints sentence, whitespace-normalized (`text.replace(/\s+/g, ' ')`), occurs exactly once in `coreForegroundSection`.

In `tests/bin-lib/stage-item/cli.test.js`, append:
- `test('AC4.1: cli: --run naming an archived (no longer present) run dir is refused (exit 3), nothing recreated (#5280)', …)`: from `fixture()`, `fs.rmSync(runDir, { recursive: true })`, call `run(['--run', runDir, '--id', 'visual-review-late-1', '--allocate', '--file', sourceFile], fakeDeps(main).deps)`, and assert code `3` and `fs.existsSync(runDir) === false`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: FAIL on the four new tests (the paragraph does not exist yet); every pre-existing test passes.

Run: `node --test tests/bin-lib/stage-item/cli.test.js`
Expected: the new AC4.1 test PASSES already. It pins existing behavior the prose relies on (`stage-item.js` header: "3 when the run dir is missing or not anchored"). If it FAILS (the CLI recreates the dir or exits other than 3), stop and report `NEEDS_CONTEXT`: the core paragraph's archived-run clause would then be false.

- [ ] **Step 3: Write the core paragraph and sentence in `plugin/skills/_shared/subagent-dispatch-core.md`**

Insert the Global Constraints restatement sentence immediately after `Read-only units keep the first-bound self-judge.` (same paragraph). Insert before `**Top-level dispatchers.**` a new paragraph, `**Rendered-UI units (#5280).**`, stating in this order:
1. A read-only unit whose result feeds the rendered-UI check before merge is a rendered-UI unit: today `/claude-tweaks:review` Step 6 (visual-review) and Step 6.5 (design-wrapper review).
2. Its dispatcher names the artifact directory it writes in the child's prompt: visual-review's `.claude-tweaks/artifacts/screenshots/browse/{session}/`, design-wrapper review's `.impeccable/review/`. A rendered-UI unit whose prompt names no artifact directory counts as unchanged.
3. At the bound, before self-judging it, probe that directory read-only (`ls -lR "{artifact-dir}"` piped to `git hash-object --stdin`) against the previous probe. Extend as for a write-capable child's worktree, with the same log line: one more 60-wait window while it changed, stopping after a window with no change or at the ceiling of 3 windows (60 minutes), naming which fired. A missing directory or failed probe counts as no change, never retried in another form. Then self-judge it as any read-only unit.
4. A self-judged rendered-UI unit never satisfies the rendered-UI check before merge. Surface it as an explicit decline, the same as a check that silently self-skipped.
5. Its late result is not ignored: write its findings to a file, run `node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "{run-dir}" --id visual-review-late-1 --allocate --file "{findings-file}"`, then log `STAGED {time} — late rendered-UI result from {unit} staged to staged/{written-file}. Reversibility: high.` with `bin/log-decision.js`. The Review Console shows it under Pending review. It never changes a verdict already reached, and a re-woken agent then repeats its whole final reply as above.
6. When `stage-item.js` exits 3 (the run dir was archived, or is not anchored), write nothing under the run dir and name the findings in your reply instead.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/foreground-execution-instruction.test.js tests/bin-lib/stage-item/cli.test.js tests/bin-lib/console/staged-id-producers.test.js`
Expected: PASS, all tests. `staged-id-producers` now scans the new `--id visual-review-late-1` producer and must find it mapped.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/subagent-dispatch-core.md tests/foreground-execution-instruction.test.js tests/bin-lib/stage-item/cli.test.js
git commit -m "Define rendered-UI units in the nested-wait rule — extend on artifact progress, stage late results (refs #5280)"
```

### Task 2: Restate the rendered-UI sentence in the six inlined copies

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md`: item 7 (~line 76), first-call template (~line 182), second-call template (~line 372). Each insertion goes directly after `Read-only units keep the first-bound self-judge.` / `Read-only units\nkeep the first-bound self-judge.`
- Modify: `plugin/skills/dispatch/express-prompt.md`: both templates' Foreground execution paragraph, after the same sentence
- Modify: `plugin/skills/flow/context-handoff.md`: the template's wait paragraph, after the same sentence
- Modify: `docs/skill-graph.md`: row at ~line 270 (`_shared/subagent-dispatch-core.md` | `task-prompt.md`'s Context pack item 7 …). Append one sentence saying the seven copies also carry the #5280 rendered-UI unit sentence (review Steps 6/6.5 get artifact-directory progress windows, and their late result is staged) and that the core section's **Rendered-UI units** paragraph holds the full rule.
- Test: `tests/foreground-execution-instruction.test.js` (append)

**Interfaces:**
- Consumes: Task 1's sentence and `primitiveCopies()` (existing, ~line 376: the seven named copies).

- [ ] **Step 1: Write the failing tests**

Append `RENDERED_UI_RULE`, matched per copy against `primitiveCopies()`:
- `/A\s+rendered-UI\s+unit\s+\(review\s+Step\s+6\/6\.5\)\s+gets\s+those\s+windows/`
- `/while\s+its\s+named\s+artifact\s+directory\s+changes/`
- `/its\s+late\s+result\s+is\s+staged\./`

Tests:
- `test('AC1.1: every copy states the rendered-UI unit sentence (#5280)', …)`: for each `[name, text]` of `primitiveCopies()`, `missingFactsOf(RENDERED_UI_RULE)(text)` deep-equals `[]` with message `name`.
- `test('AC1.1: each rendered-UI sentence assertion goes red when removed from any single copy (discrimination proof)', …)`: `assertEachPatternGoesRed` per copy.
- `test('AC1.1: the rendered-UI sentence directly follows the read-only self-judge sentence in every copy', …)`: per copy, the whitespace-normalized text contains `Read-only units keep the first-bound self-judge. A rendered-UI unit (review Step 6/6.5)`. Go-red control: doctor one copy by swapping the two sentences and assert exactly that copy fails.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: FAIL on the three new tests for six copies (`task-prompt.md item 7`, both task-prompt templates, both express templates, `context-handoff.md template`); `subagent-dispatch-core.md` passes.

- [ ] **Step 3: Insert the sentence into each of the six copies**

Insert the Global Constraints sentence verbatim after `Read-only units keep the first-bound self-judge.` in each copy, re-wrapping only the touched lines so they stay at the paragraph's existing width. Do not reword anything else. Edit `docs/skill-graph.md` as listed under Files.

- [ ] **Step 4: Verify the tests and the rail**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: PASS, all tests.

Run: `wc -c plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md plugin/skills/flow/context-handoff.md plugin/skills/_shared/subagent-dispatch-core.md`
Expected: every count ≤ 52500 (task-prompt.md ≈ 52,365).

Run: `node --test tests/bin-lib/skill-audit/context-cost.test.js` (the `rail:` suite: `rail: every shipped skill .md fits one Read call`, and `rail: every compose call site's max composed bytes fit one Read call`, which also measures composed bundles that include these files).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md plugin/skills/flow/context-handoff.md docs/skill-graph.md tests/foreground-execution-instruction.test.js
git commit -m "Restate the rendered-UI unit sentence in every inlined wait-rule copy (refs #5280)"
```

---

## Notes for the builder

- **Spec Key Files not edited, and why:** `design-wrapper/modes/review.md` and `visual-review/browser-review.md` are left alone because the core paragraph names both artifact directories, so the dispatcher never re-derives them. `plugin/bin/lib/console/resolve.js` is left alone because `visual-review-` is already mapped (spec Technical Approach: "reuse `visual-review-` … if its Review Console section fits"; it maps to Pending review, which fits late design findings too).
- **Behavior-change prose sweep:** `git grep -n -i -E "late result|arrives later|self-judged is ignored"` over `plugin/` and `docs/` finds only the seven wait-rule copies plus `docs/journeys/keep-a-second-reader-in-a-dispatched-review-3078.md`, which describes a *lens* unit's late result and so stays true. No other prose restates the ignore rule.
- **Spec AC4 says "archived or closed":** a closed-but-unarchived run dir still exists, and the console-residue banner reads its `staged/`, so staging there is useful. The rule keys on `stage-item.js`'s own refusal (exit 3 = missing or unanchored run dir) rather than adding a separate closed check. Log this at Common Step 4.5 as a Beneficial deviation.
