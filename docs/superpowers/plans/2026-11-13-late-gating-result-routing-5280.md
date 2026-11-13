# Late Rendered-UI Result Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A review Step 6 (visual-review) or Step 6.5 (design-wrapper review) nested agent gets #4557's progress-based extra wait windows, keyed on its artifact directory, and a result it returns after being abandoned is staged for the Review Console instead of ignored.

**Architecture:** Prose contract change. The full rule lives in a new `plugin/skills/_shared/rendered-ui-units.md`, read only when a rendered-UI unit is in play. One pointer sentence citing it is added, word for word, to all seven copies of the nested-`Agent` wait rule: the `subagent-dispatch-core.md` Foreground Execution Discipline section, task-prompt item 7 and both templates, both express-prompt templates, and the context-handoff template. The staged id reuses the existing `visual-review-` prefix (mapped to Pending review in `plugin/bin/lib/console/resolve.js`), so no code changes. Tests: prose pins in `tests/foreground-execution-instruction.test.js` plus one `stage-item.js` CLI test for the archived-run refusal.

**Tech Stack:** Markdown skill prose; Node 18+ `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T003014-spec-5280/work/5280-spec.md`

## Global Constraints

- Read-limit rail: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). The full rule cannot go into `subagent-dispatch-core.md`. That whole file is composed into the `review-dispatch` bundle (`plugin/bin/lib/compose-context/phases.js` line 31, `review-lens` phase), which `plan-audit.js` measures at 52,034 B max (466 B left), so a ~1.3 KB paragraph would breach it. This is why the rule gets its own `_shared` file (`shared-contract-extraction` step 3: "a bundle near the rail is reason enough to put the new text in a new `_shared` file").
- Pointer sentence, identical in all seven copies (the #4557 "one passage, the same words in all seven copies" convention, `tests/foreground-execution-instruction.test.js` ~line 517). Exact text:
  ``A rendered-UI unit (review Step 6/6.5) gets more windows while its artifact directory changes; stage its late result (`_shared/rendered-ui-units.md`).``
  150 B + 1 B of wrap. Byte budget: `task-prompt.md` 51,966 → ~52,419 (3 copies; 81 B left); `review-dispatch` bundle 52,034 → ~52,185 (315 B left). Measure both after Task 2.
- `plugin/skills/review/code-mode-steps.md` (52,429 B, 71 B headroom) is **not edited**: the new file names review Steps 6/6.5.
- Staged id: `visual-review-late-1` with `--allocate`. The prefix is already in `CANONICAL_PREFIXES` / `SECTION_MAP` → Pending review.
- Existing pins must keep passing unchanged: `Read-only units keep the first-bound self-judge`, `Ignore a late result`, `Ignore that child's result if it arrives later`, `arrives after its unit was self-judged is ignored; it never changes a verdict` (lenses and judges keep that rule).
- Commit subject style: `{Verb} {what} — {detail}`; end each commit message with `Claude-Session: https://claude.ai/code/session_01X7gPFArDmEPR7zpw7iDxZE`. Use `refs #5280`, never `closes`.

## Review Focus

1. A rendered-UI unit whose prompt names no artifact directory: counts as unchanged, so it is self-judged at the first bound exactly as today. Pinned in Task 1's `RENDERED_UI_CONTRACT`.
2. Missing artifact directory or a failed `ls -lR` probe: no change, never retried in another form. Pinned in Task 1.
3. A late result after the run dir was archived: `stage-item.js` exits 3 and recreates nothing, and the findings go in the reply. Pinned by Task 1's CLI test plus the contract fact.
4. Two late results in one run: `--allocate` reallocates. The existing `tests/bin-lib/stage-item/cli.test.js` `--allocate` collision test covers the CLI; Task 1's twin pin asserts the contract's command carries `--allocate`.
5. A lens or judge unit: unaffected. Pinned by the existing `KEEP_ALIVE` / `ITEM7` / `TEMPLATE_KEEP_ALIVE` / `PROGRESS_CHECK` arrays, which must stay green (AC2.1).

---

### Task 1: The rendered-UI unit contract

**Files:**
- Create: `plugin/skills/_shared/rendered-ui-units.md`
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (Foreground Execution Discipline section: append the pointer sentence right after `Read-only units keep the first-bound self-judge.`, ~line 108)
- Modify: `docs/skill-graph.md`: add one row for `_shared/rendered-ui-units.md` directly below the `_shared/subagent-dispatch-core.md` row at ~line 270 (same table). The row says: cited from the seven wait-rule copies by one pointer sentence; read by a dispatching agent when a review Step 6/6.5 unit is in play; holds the artifact-directory progress windows, the late-result staging (`visual-review-late-` id), the archived-run fallback, and the rendered-UI-check rule; split from `subagent-dispatch-core.md` because the `review-dispatch` bundle that composes the whole core file was near the rail (headroom-forced boundary, #5280). Also append to the line-270 row: "Since #5280 every copy also carries one pointer sentence to `_shared/rendered-ui-units.md`."
- Test: `tests/foreground-execution-instruction.test.js` (append)
- Test: `tests/bin-lib/stage-item/cli.test.js` (append)

**Interfaces:**
- Produces: `plugin/skills/_shared/rendered-ui-units.md`, and the pointer sentence inside `coreForegroundSection(readText(CORE))`. Task 2 copies the same sentence into the other six copies.

- [ ] **Step 1: Write the failing tests**

Append to `tests/foreground-execution-instruction.test.js` (`const RENDERED_UI = path.join(PLUGIN, 'skills', '_shared', 'rendered-ui-units.md')`). Add a `RENDERED_UI_CONTRACT` array of `[regex, fact]` pairs matched against `readText(RENDERED_UI)`. Each pattern matches exactly once, with `\s+` between words:
- `/review\s+Step\s+6\s+\(visual-review\)\s+and\s+Step\s+6\.5\s+\(design-wrapper\s+review\)/`: names the units (AC5.1)
- `/`\.claude-tweaks\/artifacts\/screenshots\/browse\/\{session\}\/`/` and `/`\.impeccable\/review\/`/`: the artifact directories the dispatcher names in the child's prompt (AC1.1)
- `/`ls\s+-lR\s+"\{artifact-dir\}"`\s+piped\s+to\s+`git\s+hash-object\s+--stdin`/`: the read-only probe (AC1.1)
- `/ceiling\s+of\s+3\s+windows\s+\(60\s+minutes\)/` (AC1.1)
- `/names\s+no\s+artifact\s+directory\s+counts\s+as\s+unchanged/`: Review Focus 1
- `/missing\s+directory\s+or\s+a\s+failed\s+probe\s+counts\s+as\s+no\s+change/`: Review Focus 2
- `/Lenses,\s+single\s+reads\s+and\s+judges\s+are\s+not\s+rendered-UI\s+units/`: AC2.1, scope
- `/never\s+satisfies\s+the\s+rendered-UI\s+check\s+before\s+merge/` and `/explicit\s+decline/` (AC5.1)
- `/stage-item\.js"\s+--run\s+"\{run-dir\}"\s+--id\s+visual-review-late-1\s+--allocate/` (AC3.1)
- `/STAGED\s+\{time\}\s+—\s+late\s+rendered-UI\s+result/`: the mandated decision line, which names its staged file (AC3.1)
- `/exits\s+3[^.]*?write\s+nothing\s+under\s+the\s+run\s+dir[^.]*?name\s+the\s+findings\s+in\s+(?:your|the)\s+reply/` (AC4.1)
- `/never\s+changes\s+a\s+verdict\s+already\s+reached/` (AC1.2)

Tests:
- `test('AC1.1 AC2.1 AC3.1 AC4.1 AC5.1 AC5.2: rendered-ui-units.md states the rendered-UI unit rule (#5280)', …)`: `missingFactsOf(RENDERED_UI_CONTRACT)(text)` deep-equals `[]`.
- `test('AC1.1: each rendered-UI contract assertion goes red on its own (discrimination proof)', …)`: `assertEachPatternGoesRed(text, RENDERED_UI_CONTRACT, missing)`.
- `test('AC3.1: the contract stage-item id classifies to a mapped console section (#5280)', …)`: extract the id with `/--id\s+(\S+)/`, assert `classifyStagedItem(id + '.md', '')` has `section === SECTIONS.PENDING` and `reason !== 'unmapped-prefix'` (import from `../plugin/bin/lib/console/resolve`). Go-red control in the same test: `classifyStagedItem('rendered-late-1.md', '').reason === 'unmapped-prefix'`.
- `test('AC1.1: the core section carries the rendered-UI pointer sentence once (#5280)', …)`: the Global Constraints sentence occurs exactly once in `coreForegroundSection(readText(CORE)).replace(/\s+/g, ' ')`.

Append to `tests/bin-lib/stage-item/cli.test.js`:
- `test('AC4.1: cli: --run naming an archived (no longer present) run dir is refused (exit 3), nothing recreated (#5280)', …)`: from `fixture()`, `fs.rmSync(runDir, { recursive: true })`, call `run(['--run', runDir, '--id', 'visual-review-late-1', '--allocate', '--file', sourceFile], fakeDeps(main).deps)`, and assert code `3` and `fs.existsSync(runDir) === false`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: FAIL after Step 1: the four new tests fail (the contract file does not exist yet, so `readText` throws); every pre-existing test passes.

Run: `node --test tests/bin-lib/stage-item/cli.test.js`
Expected: the new AC4.1 test PASSES already. It pins existing behavior the contract relies on (`stage-item.js` header: "3 when the run dir is missing or not anchored"). If it FAILS (the CLI recreates the dir or exits other than 3), stop with `NEEDS_CONTEXT`: the contract's archived-run clause would then be false.

- [ ] **Step 3: Write `plugin/skills/_shared/rendered-ui-units.md` and the core pointer sentence**

Title `# Rendered-UI Units — Waiting On and Routing a Merge-Gating Read-Only Unit`. A short header: what it is, that `subagent-dispatch-core.md`'s Foreground Execution Discipline and its six inlined copies cite it by one sentence, and that it was split out because of the `review-dispatch` bundle's headroom (#5280). Then state, in this order:
1. A rendered-UI unit is a read-only nested unit whose result feeds the rendered-UI check before merge: today `/claude-tweaks:review` Step 6 (visual-review) and Step 6.5 (design-wrapper review). Lenses, single reads and judges are not rendered-UI units: they keep the first-bound self-judge, and their late result is still ignored.
2. Its dispatcher names the artifact directory it writes in the child's prompt: visual-review's `.claude-tweaks/artifacts/screenshots/browse/{session}/`, design-wrapper review's `.impeccable/review/`. A rendered-UI unit whose prompt names no artifact directory counts as unchanged.
3. At the bound, before self-judging it, probe that directory read-only (`ls -lR "{artifact-dir}"` piped to `git hash-object --stdin`) against the previous probe, taken right after launch. Extend exactly as for a write-capable child's worktree, with the same wait-line log: one more 60-wait window while it changed, stopping when a whole window passes with no change or at the ceiling of 3 windows (60 minutes) per wave, naming which fired. A missing directory or a failed probe counts as no change, never retried in another form. Then self-judge it as any read-only unit.
4. A self-judged rendered-UI unit never satisfies the rendered-UI check before merge. Surface it as an explicit decline, the same as a check that silently self-skipped.
5. Its late result is staged, not ignored: write its findings to a file, run `node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "{run-dir}" --id visual-review-late-1 --allocate --file "{findings-file}"`, and log, with `bin/log-decision.js`, `STAGED {time} — late rendered-UI result from {unit} staged to staged/{written-file}. Reversibility: high.`, where `{written-file}` is the name stage-item printed. The Review Console shows it under Pending review. It never changes a verdict already reached; a re-woken agent stages, then repeats its whole final reply unchanged.
6. When `stage-item.js` exits 3 (the run dir was archived, or is not anchored), write nothing under the run dir and name the findings in your reply instead.

In `subagent-dispatch-core.md`, append the Global Constraints sentence after `Read-only units keep the first-bound self-judge.` (same paragraph). Edit `docs/skill-graph.md` as listed under Files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/foreground-execution-instruction.test.js tests/bin-lib/stage-item/cli.test.js tests/bin-lib/console/staged-id-producers.test.js`
Expected: PASS, all tests. AC2.1: every pre-existing test in the first file still passes. `staged-id-producers` now scans the new `--id visual-review-late-1` producer and must find it mapped.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/rendered-ui-units.md plugin/skills/_shared/subagent-dispatch-core.md docs/skill-graph.md tests/foreground-execution-instruction.test.js tests/bin-lib/stage-item/cli.test.js
git commit -m "Add the rendered-UI unit contract — extend on artifact progress, stage late results (refs #5280)"
```

### Task 2: Pointer sentence in the six inlined copies

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md`: item 7 (~line 76), first-call template (~line 182), second-call template (~line 372), each after `Read-only units keep the first-bound self-judge.` (the words may wrap across lines)
- Modify: `plugin/skills/dispatch/express-prompt.md`: both templates' Foreground execution paragraph, after the same sentence
- Modify: `plugin/skills/flow/context-handoff.md`: the template's wait paragraph, after the same sentence
- Test: `tests/foreground-execution-instruction.test.js` (append)

**Interfaces:**
- Consumes: Task 1's pointer sentence and `primitiveCopies()` (existing, ~line 376: the seven named copies).

- [ ] **Step 1: Write the failing tests**

Append to `tests/foreground-execution-instruction.test.js` a `RENDERED_UI_POINTER` array matched per copy of `primitiveCopies()`:
- `/A\s+rendered-UI\s+unit\s+\(review\s+Step\s+6\/6\.5\)\s+gets\s+more\s+windows\s+while\s+its\s+artifact\s+directory\s+changes;/`
- `/stage\s+its\s+late\s+result\s+\(`_shared\/rendered-ui-units\.md`\)\./`

Tests:
- `test('AC1.1: every copy carries the rendered-UI pointer sentence (#5280)', …)`: for each `[name, text]`, `missingFactsOf(RENDERED_UI_POINTER)(text)` deep-equals `[]` with message `name`.
- `test('AC1.1: each pointer assertion goes red when removed from any single copy (discrimination proof)', …)`: `assertEachPatternGoesRed` per copy.
- `test('AC1.1: the pointer sentence directly follows the read-only self-judge sentence in every copy', …)`: per copy, the whitespace-normalized text contains `Read-only units keep the first-bound self-judge. A rendered-UI unit (review Step 6/6.5)`. Go-red control: doctor one copy by moving the pointer sentence to the copy's start and assert exactly that copy fails.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: FAIL after Step 1: the three new tests fail for six copies (`task-prompt.md item 7`, both task-prompt templates, both express templates, `context-handoff.md template`); `subagent-dispatch-core.md` passes.

- [ ] **Step 3: Insert the sentence into each of the six copies**

Insert the Global Constraints sentence verbatim after `Read-only units keep the first-bound self-judge.` in each copy, re-wrapping only the touched lines to the paragraph's existing width. Do not reword anything else.

- [ ] **Step 4: Verify the tests and the rail (AC6.1, AC6.2)**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: PASS, all tests.

Run: `wc -c plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md plugin/skills/flow/context-handoff.md plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/_shared/rendered-ui-units.md`
Expected: every count ≤ 52500 (task-prompt.md ≈ 52,419).

Run: `node --test tests/bin-lib/skill-audit/context-cost.test.js` (the `rail:` suite: every shipped skill `.md` fits one Read call, and every compose call site's max composed bytes fit, `review-dispatch` included).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md plugin/skills/flow/context-handoff.md tests/foreground-execution-instruction.test.js
git commit -m "Point every inlined wait-rule copy at the rendered-UI unit contract (refs #5280)"
```

---

## Notes for the builder

- **AC7.1 (`npm test` passes)** is verified by `/build` Common Step 5's full verification run, not by a task.
- **Spec Key Files not edited, and why:** `design-wrapper/modes/review.md` and `visual-review/browser-review.md` are left alone because the contract names both artifact directories, so the dispatcher never re-derives them. `plugin/bin/lib/console/resolve.js` is left alone because `visual-review-` is already mapped (spec Technical Approach: "reuse `visual-review-` … if its Review Console section fits"; it maps to Pending review, which fits late design findings too). `bin/dispatch-prompt.js` renders `task-prompt.md`'s fenced blocks verbatim, so it needs no change. `review/code-mode-steps.md` is left alone for the headroom reason above, and the spec Deliverable 4 already says so.
- **Behavior-change prose sweep:** `git grep -n -i -E "late result|arrives later|self-judged is ignored"` over `plugin/` and `docs/` finds only the seven wait-rule copies plus `docs/journeys/keep-a-second-reader-in-a-dispatched-review-3078.md`, which describes a *lens* unit's late result and so stays true. No other prose restates the ignore rule as absolute without the lens context.
- **Spec AC4 says "archived or closed":** a closed-but-unarchived run dir still exists, and the console-residue banner reads its `staged/`, so staging there is useful. The contract keys on `stage-item.js`'s own refusal (exit 3 = missing or unanchored run dir) rather than adding a separate closed check. Log this at Common Step 4.5 as a Beneficial deviation.
- **New file's boundary is headroom-forced** (`shared-contract-extraction`'s "When headroom forces a split" gotcha): say so in the file header and in the skill-graph row.
