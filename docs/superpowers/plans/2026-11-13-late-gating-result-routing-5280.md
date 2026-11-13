# Late Rendered-UI Result Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A review Step 6 (visual-review) or Step 6.5 (design-wrapper review) nested agent gets #4557's progress-based extra wait windows, keyed on its artifact directory, and a result it returns after being abandoned is staged for the Review Console while its run is active, instead of being ignored.

**Architecture:** Prose contract change. The full rule lives in a new `plugin/skills/_shared/rendered-ui-units.md`. One exception sentence citing it is added, word for word, to all seven copies of the nested-`Agent` wait rule: the core section, task-prompt item 7 and both templates, both express-prompt templates, and the context-handoff template. The skill sites that launch these children (visual-review's page and journey agents, design-wrapper review's Steps 3.7/3.8) name the child a rendered-UI unit and give its artifact directory where one exists. The staged id is `visual-review-late-{n}`. It is already mapped to Pending review by the `visual-review-` prefix in `plugin/bin/lib/console/resolve.js`, so there is no code change, but `release/disposition.md` gains a longest-prefix roster row routed `proposal`.

**Tech Stack:** Markdown skill prose; Node 18+ `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T003014-spec-5280/work/5280-spec.md` (read its `## Plan Review Clarifications` section: two of its four lines were decided by the user at plan review).

## Global Constraints

- Read-limit rail: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). The full rule cannot go into `subagent-dispatch-core.md`. That whole file is composed into the `review-dispatch` bundle (`plugin/bin/lib/compose-context/phases.js` line 31), measured at 52,034 B max, so the rule gets its own `_shared` file (`shared-contract-extraction` step 3). The boundary is headroom-forced; say so in the file header and in the skill-graph row.
- Exception sentence, identical in all seven copies (the #4557 "one passage, the same words in all seven copies" convention). Exact text:
  ``Exception: a rendered-UI unit (review Step 6/6.5) gets more windows while its artifact directory changes; stage its late result (`rendered-ui-units.md`).``
  It sits directly after `Read-only units keep the first-bound self-judge.` and is what re-scopes each copy's "ignore a late result" sentence to non-rendered-UI units (spec AC2); those sentences stay byte-unchanged, so their existing pins keep passing. It costs 153 B + 1 B of wrap: `task-prompt.md` goes 51,966 → ~52,428 (3 copies), and the `review-dispatch` bundle goes 52,034 → ~52,188. Measure both after Task 2.
- `plugin/skills/review/code-mode-steps.md` (52,429 B) is **not edited**.
- Staged id `visual-review-late-1` with `--allocate`. Findings file: a session temp path from `bin/session-tmp-resolve.js`, **never** under `{run-dir}` (a write there would recreate an archived run dir before `stage-item.js` could refuse).
- Decision log call: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --section "{section}" --status STAGED --step "late rendered-UI result" --reversibility high --text-file "{text-file}"`. The text file holds only `late rendered-UI result from {unit} staged to staged/{written-file}.` (`log-decision.js` writes the status and time itself; interpolated text goes through `--text-file`, `_shared/auto-decision-log.md` ~line 78).
- Commit subject style: `{Verb} {what} — {detail}`; end each commit message with `Claude-Session: https://claude.ai/code/session_01X7gPFArDmEPR7zpw7iDxZE`. Use `refs #5280`, never `closes`.

## Review Focus

1. A rendered-UI unit whose prompt names no artifact directory (design-wrapper Steps 3.7/3.8 by design): it counts as unchanged, so it is self-judged at the first bound, but its late result is still staged. Pinned in Task 1.
2. Missing artifact directory or a failed `ls -lR` probe: no change, never retried in another form. Pinned in Task 1.
3. A late result after the run closed (`run-state.json` `status` not `active`), after the console rendered (`console.json` present), or after archival (`stage-item.js` exit 3): nothing written under the run dir, findings in the reply. Pinned in Task 1 (contract facts plus a CLI test for exit 3).
4. Two late results in one run: `--allocate` reallocates. The existing CLI `--allocate` test covers it; Task 1's twin pin asserts the contract command carries `--allocate`.
5. A lens or judge unit: unaffected. Pinned by the existing `KEEP_ALIVE` / `ITEM7` / `TEMPLATE_KEEP_ALIVE` / `PROGRESS_CHECK` arrays (AC2.1) and the contract's own "Lenses, single reads and judges are not rendered-UI units" fact.

---

### Task 1: The rendered-UI unit contract

**Review risk:** high

**Files:**
- Create: `plugin/skills/_shared/rendered-ui-units.md`
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (Foreground Execution Discipline: the exception sentence after `Read-only units keep the first-bound self-judge.`, ~line 108)
- Modify: `plugin/skills/release/disposition.md` (Review staging roster: a new row directly above the `visual-review-` row: `` | `visual-review-late-` | `staged/visual-review-late-{n}.md` | `_shared/rendered-ui-units.md` (a late review Step 6/6.5 result) | one finding per file | `proposal` | ``)
- Modify: `docs/skill-graph.md`: one new row for `_shared/rendered-ui-units.md` directly below the `_shared/subagent-dispatch-core.md` row at ~line 270 (same table). Say who cites it (the seven wait-rule copies; page-mode, discover-mode and design-wrapper review), what it holds, and that the split is headroom-forced (#5280). Append to the line-270 row: "Since #5280 every copy also carries one exception sentence pointing at `_shared/rendered-ui-units.md`."
- Test: `tests/foreground-execution-instruction.test.js` (append)
- Test: `tests/bin-lib/stage-item/cli.test.js` (append)

**Interfaces:**
- Produces: `plugin/skills/_shared/rendered-ui-units.md`; the exception sentence inside `coreForegroundSection(readText(CORE))`. Task 2 copies the sentence to the other six copies; Task 3 cites the file from the launch sites.

- [ ] **Step 1: Write the failing tests**

Append to `tests/foreground-execution-instruction.test.js` (`const RENDERED_UI = path.join(PLUGIN, 'skills', '_shared', 'rendered-ui-units.md')`). Add a `RENDERED_UI_CONTRACT` array of `[regex, fact]` pairs matched against `readText(RENDERED_UI)`, each matching exactly once, with `\s+` between words:
- `/review\s+Step\s+6\s+\(visual-review\)\s+and\s+Step\s+6\.5\s+\(design-wrapper\s+review\)/` (AC5.1)
- `/Steps?\s+3\.7\s+and\s+3\.8[^.]*?no\s+artifact\s+directory/`: the 3.7/3.8 children are stage-only (clarification 2)
- `/`\.claude-tweaks\/artifacts\/screenshots\/browse\/\{session\}\/`/` and `/`\.impeccable\/review\/`/` (AC1.1)
- `/`ls\s+-lR\s+"\{artifact-dir\}"`\s+piped\s+to\s+`git\s+hash-object\s+--stdin`/` (AC1.1)
- `/ceiling\s+of\s+3\s+windows\s+\(60\s+minutes\)/` (AC1.1)
- `/names\s+no\s+artifact\s+directory\s+counts\s+as\s+unchanged/`: Review Focus 1
- `/missing\s+directory\s+or\s+a\s+failed\s+probe\s+counts\s+as\s+no\s+change/`: Review Focus 2
- `/Lenses,\s+single\s+reads\s+and\s+judges\s+are\s+not\s+rendered-UI\s+units/` (AC2.1)
- `/never\s+satisfies\s+the\s+rendered-UI\s+check\s+before\s+merge/` and `/explicit\s+decline/` (AC5.1)
- `/session-tmp-resolve\.js[\s\S]*?never\s+under\s+the\s+run\s+dir/`: findings file location
- `/stage-item\.js"\s+--run\s+"\{run-dir\}"\s+--id\s+visual-review-late-1\s+--allocate/` and `/staged\/visual-review-late-\{n\}\.md/` (AC3.1)
- `/--status\s+STAGED[\s\S]*?--reversibility\s+high\s+--text-file/` and `/late\s+rendered-UI\s+result\s+from\s+\{unit\}\s+staged\s+to\s+staged\/\{written-file\}\./` (AC3.1)
- `/`status`\s+is\s+anything\s+but\s+`active`/`, `/`console\.json`\s+exists/`, and `/exits\s+3/`, each inside the sentence that ends `name the findings in your reply instead` (AC4.1 and clarification 1). Assert with one regex: `/`status`\s+is\s+anything\s+but\s+`active`[^.]*?`console\.json`\s+exists[^.]*?exits\s+3[^.]*?write\s+nothing\s+under\s+the\s+run\s+dir[^.]*?name\s+the\s+findings\s+in\s+your\s+reply\s+instead/`
- `/never\s+changes\s+a\s+verdict\s+already\s+reached/` (AC1.2)

Tests:
- `test('AC1.1 AC1.2 AC2.1 AC3.1 AC4.1 AC5.1 AC5.2: rendered-ui-units.md states the rendered-UI unit rule (#5280)', …)`: `missingFactsOf(RENDERED_UI_CONTRACT)(text)` deep-equals `[]`.
- `test('AC1.1: each rendered-UI contract assertion goes red on its own (discrimination proof)', …)`: `assertEachPatternGoesRed`.
- `test('AC3.1: the contract stage-item id classifies to a mapped console section (#5280)', …)`: extract the id with `/--id\s+(\S+)/`; `classifyStagedItem(id + '.md', '')` has `section === SECTIONS.PENDING` and `reason !== 'unmapped-prefix'`. Go-red control: `classifyStagedItem('rendered-late-1.md', '').reason === 'unmapped-prefix'`.
- `test('AC1.1: the core section carries the rendered-UI exception sentence once (#5280)', …)`: the Global Constraints sentence occurs exactly once in `coreForegroundSection(readText(CORE)).replace(/\s+/g, ' ')`.

Append to `tests/bin-lib/stage-item/cli.test.js`:
- `test('AC4.1: cli: --run naming an archived (no longer present) run dir is refused (exit 3), nothing recreated (#5280)', …)`: from `fixture()`, `fs.rmSync(runDir, { recursive: true })`, call `run(['--run', runDir, '--id', 'visual-review-late-1', '--allocate', '--file', sourceFile], fakeDeps(main).deps)`, and assert code `3` and `fs.existsSync(runDir) === false`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: FAIL after Step 1: the four new tests fail (the contract file does not exist yet); every pre-existing test passes.

Run: `node --test tests/bin-lib/stage-item/cli.test.js`
Expected: the new AC4.1 test PASSES already. It pins existing behavior the contract relies on (`stage-item.js` header: "3 when the run dir is missing or not anchored"). If it FAILS, stop with `NEEDS_CONTEXT`: the contract's archived clause would be false.

- [ ] **Step 3: Write `plugin/skills/_shared/rendered-ui-units.md`, the core sentence, the roster row and the graph rows**

Title `# Rendered-UI Units — Waiting On and Routing a Merge-Gating Read-Only Unit`. A short header naming its citers (`subagent-dispatch-core.md`'s Foreground Execution Discipline and its six inlined copies; `visual-review/page-mode.md`, `visual-review/discover-mode.md`, `design-wrapper/modes/review.md`) and stating that the split is headroom-forced (#5280). It applies wherever a dispatching agent's keep-alive bound applies (`subagent-dispatch-core.md`). Then, in this order:
1. A rendered-UI unit is a read-only nested unit whose result feeds the rendered-UI check before merge: `/claude-tweaks:review` Step 6 (visual-review) and Step 6.5 (design-wrapper review), and the children each launches. Lenses, single reads and judges are not rendered-UI units: they keep the first-bound self-judge, and their late result is still ignored.
2. The dispatcher names the child's artifact directory in its prompt: a visual-review page or journey agent's `.claude-tweaks/artifacts/screenshots/browse/{session}/`, or `.claude-tweaks/artifacts/screenshots/browse/` for a whole visual-review unit; a whole design-wrapper review unit's `.impeccable/review/`. Design-wrapper review's Steps 3.7 and 3.8 children have no artifact directory: they only read screenshots already captured. A rendered-UI unit whose prompt names no artifact directory counts as unchanged.
3. At the bound, before self-judging, probe the directory read-only (`ls -lR "{artifact-dir}"` piped to `git hash-object --stdin`) against the previous probe, taken right after launch. Extend exactly as for a write-capable child's worktree, with the same wait-line log: one more 60-wait window while it changed, stopping when a whole window passes with no change or at the ceiling of 3 windows (60 minutes) per wave, naming which fired. A missing directory or a failed probe counts as no change, never retried in another form. Then self-judge it as any read-only unit.
4. A self-judged rendered-UI unit never satisfies the rendered-UI check before merge. Surface it as an explicit decline, the same as a check that silently self-skipped.
5. Its late result is staged, not ignored, but only while the run is active. Read `{run-dir}/run-state.json`. When its `status` is anything but `active`, `{run-dir}/console.json` exists, or `stage-item.js` (below) exits 3 (archived or unanchored), write nothing under the run dir and name the findings in your reply instead. Otherwise:
   - Write the findings to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value rendered-late-{unit-slug}.md` prints, never under the run dir.
   - Run `node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "{run-dir}" --id visual-review-late-1 --allocate --file "{findings-file}"`, which writes `staged/visual-review-late-{n}.md`.
   - Log the Global Constraints `log-decision.js` call, its text file holding `late rendered-UI result from {unit} staged to staged/{written-file}.`, where `{written-file}` is the name stage-item printed.

   The Review Console shows it under Pending review. It never changes a verdict already reached. A re-woken agent stages first, then repeats its whole final reply unchanged.

In `subagent-dispatch-core.md`, append the exception sentence after `Read-only units keep the first-bound self-judge.` Add the `disposition.md` roster row and both `docs/skill-graph.md` edits as listed under Files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/foreground-execution-instruction.test.js tests/bin-lib/stage-item/cli.test.js tests/bin-lib/console/staged-id-producers.test.js tests/release-run-dir-lifecycle-conformance.test.js`
Expected: PASS, all tests. AC2.1: every pre-existing test in the first file still passes. `staged-id-producers` scans the new producer and finds its id mapped. The roster suite now scans `_shared/rendered-ui-units.md` (named by the new row) and classifies `staged/visual-review-late-1.md` to the `visual-review-late-` row by longest prefix.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/rendered-ui-units.md plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/release/disposition.md docs/skill-graph.md tests/foreground-execution-instruction.test.js tests/bin-lib/stage-item/cli.test.js
git commit -m "Add the rendered-UI unit contract — extend on artifact progress, stage late results (refs #5280)"
```

### Task 2: Exception sentence in the six inlined copies

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md`: item 7 (~line 76), first-call template (~line 182), second-call template (~line 372), each after `Read-only units keep the first-bound self-judge.` (the words may wrap across lines)
- Modify: `plugin/skills/dispatch/express-prompt.md`: both templates' Foreground execution paragraph, after the same sentence
- Modify: `plugin/skills/flow/context-handoff.md`: the template's wait paragraph, after the same sentence
- Test: `tests/foreground-execution-instruction.test.js` (append)

**Interfaces:**
- Consumes: Task 1's sentence and `primitiveCopies()` (existing, ~line 376: the seven named copies).

- [ ] **Step 1: Write the failing tests**

Append to `tests/foreground-execution-instruction.test.js` a `RENDERED_UI_EXCEPTION` array matched per copy of `primitiveCopies()`:
- `/Exception:\s+a\s+rendered-UI\s+unit\s+\(review\s+Step\s+6\/6\.5\)\s+gets\s+more\s+windows\s+while\s+its\s+artifact\s+directory\s+changes;/`
- `/stage\s+its\s+late\s+result\s+\(`rendered-ui-units\.md`\)\./`

Tests:
- `test('AC1.1 AC2.1: every copy carries the rendered-UI exception sentence (#5280)', …)`: per copy, `missingFactsOf(RENDERED_UI_EXCEPTION)(text)` deep-equals `[]` with message `name`.
- `test('AC1.1: each exception assertion goes red when removed from any single copy (discrimination proof)', …)`: `assertEachPatternGoesRed` per copy.
- `test('AC1.1: the exception sentence directly follows the read-only self-judge sentence in every copy', …)`: per copy, the whitespace-normalized text contains `Read-only units keep the first-bound self-judge. Exception: a rendered-UI unit (review Step 6/6.5)`. Go-red control: doctor one copy by moving the exception sentence to the copy's start, and assert exactly that copy fails.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: FAIL after Step 1: the three new tests fail for six copies; `subagent-dispatch-core.md` passes.

- [ ] **Step 3: Insert the sentence into each of the six copies**

Insert the Global Constraints sentence verbatim after `Read-only units keep the first-bound self-judge.` in each copy, re-wrapping only the touched lines to the paragraph's existing width. Do not reword anything else.

- [ ] **Step 4: Verify the tests and the rail (AC6.1, AC6.2)**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: PASS, all tests.

Run: `wc -c plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md plugin/skills/flow/context-handoff.md plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/_shared/rendered-ui-units.md`
Expected: every count ≤ 52500 (task-prompt.md ≈ 52,428).

Run: `node --test tests/bin-lib/skill-audit/context-cost.test.js` (the `rail:` suite: every shipped skill `.md` and every compose call site's max composed bytes, `review-dispatch` included).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md plugin/skills/flow/context-handoff.md tests/foreground-execution-instruction.test.js
git commit -m "Add the rendered-UI exception to every inlined wait-rule copy (refs #5280)"
```

### Task 3: Launch sites name their rendered-UI children

**Files:**
- Modify: `plugin/skills/visual-review/page-mode.md`: the `> **Contract:**` note at ~line 31 (parallel page agents)
- Modify: `plugin/skills/visual-review/discover-mode.md`: the `> **Parallel execution (conditional):**` note at ~line 85 (parallel journey agents)
- Modify: `plugin/skills/design-wrapper/modes/review.md`: Step 3.7's **Dispatch.** paragraph (~line 88) and Step 3.8's `> **Contract:**` note (~line 246)
- Test: `tests/rendered-ui-units-launch-sites.test.js` (create)

**Interfaces:**
- Consumes: `plugin/skills/_shared/rendered-ui-units.md` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `tests/rendered-ui-units-launch-sites.test.js` (pattern: `tests/foreground-execution-instruction.test.js`'s `missingFactsOf` / `assertEachPatternGoesRed` from `./helpers/conformance-asserts`, `readText` from `./helpers/read-skill`). One `[file, region, facts]` entry per site, with the region sliced to the named note or paragraph:
- `visual-review/page-mode.md`, `> **Contract:**` line: `/rendered-UI\s+unit/`, `/`(?:\.\.\/)*_shared\/rendered-ui-units\.md`/`, `/`\.claude-tweaks\/artifacts\/screenshots\/browse\/\{session\}\/`/`
- `visual-review/discover-mode.md`, `> **Parallel execution (conditional):**` line: the same three facts
- `design-wrapper/modes/review.md`, Step 3.7 `**Dispatch.**` paragraph: `/rendered-UI\s+unit/`, `/`\.\.\/\.\.\/_shared\/rendered-ui-units\.md`/`, `/no\s+artifact\s+directory/`
- `design-wrapper/modes/review.md`, Step 3.8 `> **Contract:**` line: the same three facts as 3.7

Tests: `test('AC1.1: each rendered-UI launch site names its child a rendered-UI unit and its artifact directory (#5280)', …)` and `test('AC1.1: each launch-site fact goes red on its own (discrimination proof)', …)`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/rendered-ui-units-launch-sites.test.js`
Expected: FAIL: every site is missing its facts.

- [ ] **Step 3: Add one sentence at each site**

- page-mode and discover-mode: each agent is a rendered-UI unit (`../_shared/rendered-ui-units.md`). Name its session's screenshot directory, `.claude-tweaks/artifacts/screenshots/browse/{session}/`, in its prompt.
- design-wrapper 3.7/3.8: each child is a rendered-UI unit with no artifact directory (`../../_shared/rendered-ui-units.md`): no extra window, and a late result is staged.

Keep the existing text; append one sentence per site.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/rendered-ui-units-launch-sites.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/visual-review/page-mode.md plugin/skills/visual-review/discover-mode.md plugin/skills/design-wrapper/modes/review.md tests/rendered-ui-units-launch-sites.test.js
git commit -m "Name rendered-UI children at visual-review and design-wrapper launch sites (refs #5280)"
```

---

## Notes for the builder

- **AC7.1 (`npm test` passes)** is verified by `/build` Common Step 5's full verification run, not by a task.
- **Spec Key Files resolved differently:** the spec's `visual-review/browser-review.md` line points at the dispatch, but the parallel page and journey dispatches live in `page-mode.md` and `discover-mode.md` (`page-mode.md` line 4: "Loaded from `browser-review.md`'s Page Mode dispatch"), so Task 3 edits those. `plugin/bin/lib/console/resolve.js` needs no change, since the `visual-review-` regex already maps `visual-review-late-`. `bin/dispatch-prompt.js` renders `task-prompt.md` verbatim. `review/code-mode-steps.md` is not edited (headroom).
- **Behavior-change prose sweep:** `git grep -n -i -E "late result|arrives later|self-judged is ignored"` over `plugin/` and `docs/` finds only the seven wait-rule copies (each now followed by the exception sentence) plus `docs/journeys/keep-a-second-reader-in-a-dispatched-review-3078.md`, which describes a *lens* unit and stays true.
