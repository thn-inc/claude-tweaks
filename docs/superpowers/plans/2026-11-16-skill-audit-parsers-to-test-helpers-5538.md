# Move the Two Test-Only skill-audit Parsers to tests/helpers (#5538) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution:** batched

**Batch:** send every task to one implementer as a single brief; review the combined diff once.

**Goal:** Stop shipping `argument-hint.js` and `option-description.js` in the plugin payload by moving them to `tests/helpers/`, where their only importers live.

**Architecture:** A pure move. `git mv` keeps history; the only content changes are one internal `require` path, the two module headers, ten `require`/comment lines in test files, and one clause of one `docs/plugin-structure.md` row. No re-export is left behind in `plugin/`.

**Tech Stack:** Node (CommonJS), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T231051-spec-5538-5552/spec-5538/work/5538-spec.md` (materialized from GitHub issue #5538)

## Global Constraints

- Do not change what either module parses or exports, or what any suite asserts. Exports stay `{ extractArgumentHint, inputSectionBody }` and `{ extractDescriptionFields, flagQuestionMarks, listMarkdownFiles }`.
- Do not move any other `plugin/bin/lib/skill-audit/` module, and do not rename any test file. `tests/bin-lib/skill-audit/option-description.test.js` keeps its path, so `tools/test-durations.json` is not edited.
- Leave no re-export or stub at the old `plugin/bin/lib/skill-audit/` paths.
- `docs/superpowers/plans/2026-11-12-ci-workflow-review.md:536` cites the old path. It is a historical plan: leave it.
- `listMarkdownFiles` in `plugin/bin/lib/wrap-up/facts.js` is an unrelated private function with the same name. It is not a consumer; do not touch it.
- Use `git mv` for both moves (history must follow the file, AC5).
- Commit style: `{Verb} {what} — {detail}`, imperative, no conventional-commit prefix; body line `refs #5538`; last line `Claude-Session: https://claude.ai/code/session_01UwjosHw5wcz1a5BNJTJCmu`.
- Governing project skills: none apply. `git grep -n -e "argument-hint.js" -e "option-description" -- .claude/skills` prints nothing, and `.claude/skills/single-source-constant-guard/SKILL.md:49` only endorses `tests/helpers/` as the home for shared test code.
- Scope and edit discipline (verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Review Focus

1. A source-scan suite that enumerates `plugin/bin/lib/skill-audit/` or `tests/helpers/` (file lists, header rules, test-path mirrors) may go red on a file appearing or disappearing. No task test names such a suite, so the full suite at Common Step 5 is the gate (spec Gotcha 3, AC6).
2. The corpus-wide `?` gate silently scanning nothing after the move. Task 2 Step 5 is the mutation check that proves it still reads the live corpus (AC4).
3. History not following the move because the header rewrite drops rename similarity. Task 1 Step 5 and Task 2 Step 4 check `git log --follow` (AC5).
4. A stale mention of the old paths surviving outside history. Task 2 Step 4's grep covers `plugin` and `tests` (AC2); `docs/plugin-structure.md:24` is edited in Task 2 Step 3.
5. A leftover re-export at the old path masking a missed importer. AC1's `git ls-files` check in each task proves the old files are gone.

---

### Task 1: Move `argument-hint.js` and repoint its eight importers

**Files:**
- Modify: `plugin/bin/lib/skill-audit/argument-hint.js` (removed from this path by `git mv`)
- Create: `tests/helpers/argument-hint.js` (the moved file)
- Modify: `tests/argument-hint-input.test.js:41` (require) and `:139` (comment)
- Modify: `tests/argument-hint-mirrors.test.js:24`
- Modify: `tests/batch-ref-argument.test.js:20`
- Modify: `tests/flow-claim-preflight.test.js:303` (inline require inside one test)
- Modify: `tests/init-ci-workflow-review-conformance.test.js:12`
- Modify: `tests/specify-batch-input.test.js:16`
- Modify: `tests/specify-next-mode.test.js:13`
- Modify: `tests/sweep-orchestrator.test.js:21`

**Interfaces:**
- Consumes: `splitFrontmatterFence` from `plugin/bin/lib/health-core/frontmatter-list` (stays where it is).
- Produces: `tests/helpers/argument-hint.js` exporting `{ extractArgumentHint, inputSectionBody }`, unchanged signatures.

- [ ] **Step 1: Repoint the importers first (this is the failing test)**

In each of the eight files replace `require('../plugin/bin/lib/skill-audit/argument-hint')` with `require('./helpers/argument-hint')`. Change nothing else on those lines (the destructured names stay as they are).

In `tests/argument-hint-input.test.js:139`, the comment line `// value verbatim (plugin/bin/lib/skill-audit/argument-hint.js's own` becomes `// value verbatim (tests/helpers/argument-hint.js's own`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/argument-hint-input.test.js`
Expected: FAIL with `Cannot find module './helpers/argument-hint'`

- [ ] **Step 3: Move the module**

Run: `git mv plugin/bin/lib/skill-audit/argument-hint.js tests/helpers/argument-hint.js`

Then, in `tests/helpers/argument-hint.js`:

- Change `require('../health-core/frontmatter-list')` to `require('../../plugin/bin/lib/health-core/frontmatter-list')`.
- Replace the header comment (old lines 3-12, from `// argument-hint frontmatter extraction, shared by` through `// file's registrations.`) with exactly:

```js
// Test tooling, not plugin code: argument-hint frontmatter extraction for the
// conformance suites under tests/. It lives in tests/helpers/ so the installed
// plugin does not ship it (#5538). Import the functions from here, never from
// a test file: requiring a test file re-runs its `test()` calls inside the
// importer's process and inflates node --test's reported count (#751).
```

Leave every line below the `require` untouched.

- [ ] **Step 4: Run the eight importers (AC3.1)**

Run: `node --test tests/argument-hint-input.test.js tests/argument-hint-mirrors.test.js tests/batch-ref-argument.test.js tests/flow-claim-preflight.test.js tests/init-ci-workflow-review-conformance.test.js tests/specify-batch-input.test.js tests/specify-next-mode.test.js tests/sweep-orchestrator.test.js`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit, then check history follows the move (AC5.1, AC1.1)**

```bash
git add tests/helpers/argument-hint.js tests/argument-hint-input.test.js tests/argument-hint-mirrors.test.js tests/batch-ref-argument.test.js tests/flow-claim-preflight.test.js tests/init-ci-workflow-review-conformance.test.js tests/specify-batch-input.test.js tests/specify-next-mode.test.js tests/sweep-orchestrator.test.js
git commit -m "Move argument-hint.js to tests/helpers — only test files import it" -m "refs #5538" -m "Claude-Session: https://claude.ai/code/session_01UwjosHw5wcz1a5BNJTJCmu"
```

(`git mv` already staged the deletion of the old path.)

Run: `git log --follow --oneline -- tests/helpers/argument-hint.js`
Expected: more than one commit, the oldest predating this branch (history from before the move).

Run: `git ls-files plugin/bin/lib/skill-audit/argument-hint.js`
Expected: no output (AC1, first half).

---

### Task 2: Move `option-description.js`, repoint its importer, and fix the docs row

**Files:**
- Modify: `plugin/bin/lib/skill-audit/option-description.js` (removed from this path by `git mv`)
- Create: `tests/helpers/option-description.js` (the moved file)
- Modify: `tests/bin-lib/skill-audit/option-description.test.js:13`
- Modify: `docs/plugin-structure.md:24`
- Waived `tools/test-durations.json`: the test file it names does not move, so Step 4 only confirms nothing there needs changing.
- Waived `plugin/bin/lib/wrap-up/facts.js`: holds an unrelated private function with the same name; Global Constraints says not to touch it.
- Waived `tests/helpers/strip-comments.js`: the spec names it only as precedent for a move in the other direction.
- Waived `plugin/bin/lib/strip-comments.js`: same precedent; not read or changed.
- Waived `docs/superpowers/plans/2026-11-12-ci-workflow-review.md`: historical plan; Global Constraints says to leave it.

Step 5 also edits one line of `plugin/skills/flow/validation.md` as a scratch mutation and reverts it; nothing is committed there.

Waived AC2.3: an explanatory note, not a testable clause — `tools` is outside AC2's grep scope by design, and Step 4's second grep covers `docs/plugin-structure.md:24`.
Waived AC6.1: the whole-suite pass is `/claude-tweaks:build` Common Step 5's runner check (see Folded verification), not a task step.

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `tests/helpers/option-description.js` exporting `{ extractDescriptionFields, flagQuestionMarks, listMarkdownFiles }`, unchanged.

- [ ] **Step 1: Repoint the importer first (this is the failing test)**

In `tests/bin-lib/skill-audit/option-description.test.js:13` replace `require('../../../plugin/bin/lib/skill-audit/option-description.js')` with `require('../../helpers/option-description.js')`. Line 14's `skill-catalog.js` require and line 15's `read-skill` require are unchanged.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/skill-audit/option-description.test.js`
Expected: FAIL with `Cannot find module '../../helpers/option-description.js'`

- [ ] **Step 3: Move the module, update its header, fix the docs row**

Run: `git mv plugin/bin/lib/skill-audit/option-description.js tests/helpers/option-description.js`

In `tests/helpers/option-description.js`, insert these three lines directly above the existing first comment line (`// Parser for \`AskUserQuestion\` option \`description\` fields authored in skill`), followed by a line holding only `//`:

```js
// Test tooling, not plugin code: used by the corpus-wide conformance test in
// tests/bin-lib/skill-audit/option-description.test.js. It lives in
// tests/helpers/ so the installed plugin does not ship it (#5538).
//
```

Leave the rest of the file untouched (it uses no relative `require` and no `__dirname`).

In `docs/plugin-structure.md:24` (the `plugin/bin/lib/skill-audit/` row), delete exactly this clause, including its trailing space, and add nothing in its place:

```
Plus option-description.js (#659): parses `AskUserQuestion` option `description` fields and flags a literal `?` — deliberation leaking into the option surface instead of stating the consequence, per docs/skill-authoring.md's Decisions bullet — exercised only by its own corpus-wide conformance test, never called at harness-health runtime. 
```

The row then reads `… via \`bin/harness-cost-report.js\`. \`load.js\` is the per-invocation load model (#3307) …`.

- [ ] **Step 4: Run the importer and the absence checks (AC1.1, AC2.1, AC2.2, AC3.1)**

Run: `node --test tests/bin-lib/skill-audit/option-description.test.js`
Expected: PASS, 7 tests, `fail 0`

Run: `git ls-files plugin/bin/lib/skill-audit/argument-hint.js plugin/bin/lib/skill-audit/option-description.js`
Expected: no output.

Run: `git ls-files tests/helpers/argument-hint.js tests/helpers/option-description.js`
Expected: both paths.

Run: `git grep -n -e "skill-audit/argument-hint" -e "skill-audit/option-description" -- plugin tests`
Expected: no output, exit 1. (Control, recorded at plan time on the base tree: the same command printed ten lines, all under `tests/`.)

Run: `git grep -n -F "option-description.js" -- docs/plugin-structure.md`
Expected: no output, exit 1. (Control at plan time: one line, `docs/plugin-structure.md:24`.)

- [ ] **Step 5: Mutation check — the corpus gate still reads the live corpus (AC4.1)**

In `plugin/skills/flow/validation.md`, on the Option 1 line whose description is `"Run /claude-tweaks:specify {plan-path} to decompose before continuing"`, change `before continuing"` to `before continuing?"`.

Run: `node --test tests/bin-lib/skill-audit/option-description.test.js`
Expected: FAIL in the test `no shipped skills/**/*.md file has an AskUserQuestion option description containing a literal ?`, naming `flow/validation.md`.

Revert the one-character edit by hand, then:

Run: `git diff --quiet -- plugin/skills/flow/validation.md`
Expected: exit 0 (file identical to HEAD).

Run: `node --test tests/bin-lib/skill-audit/option-description.test.js`
Expected: PASS.

Report the failing run's summary lines (the violation line and the `fail` count) in the task report. The controller records them as the run's `AC evidence` entry (`$PIPELINE_RUN_DIR/evidence/ac4-mutation.txt` plus one `decisions.md` line through `log-decision.js --section "/build" --status AUTO --step "AC evidence"`); the implementer writes nothing under `.claude-tweaks/`.

- [ ] **Step 6: Commit, then check history follows the move (AC5.1)**

```bash
git add tests/helpers/option-description.js tests/bin-lib/skill-audit/option-description.test.js docs/plugin-structure.md
git commit -m "Move option-description.js to tests/helpers — drop it from the skill-audit docs row" -m "refs #5538" -m "Claude-Session: https://claude.ai/code/session_01UwjosHw5wcz1a5BNJTJCmu"
```

Run: `git log --follow --oneline -- tests/helpers/option-description.js`
Expected: more than one commit (history from before the move).

Run: `git status --porcelain`
Expected: no output.

---

## Folded verification

AC6 (`npm test -- --full` passes) is `/claude-tweaks:build` Common Step 5's runner check, taken from the PR's CI job per `.claude-tweaks/verify-scope.json`. No task runs the whole suite.

## Spec coverage map

| Clause | Covered by |
|---|---|
| AC1.1 | Task 1 Step 5 (`git ls-files` on the old path); Task 2 Step 4 (both `git ls-files` runs) |
| AC2.1 | Task 2 Step 4 (`git grep` over `plugin tests` prints nothing) |
| AC2.2 | Task 2 Step 4 (control recorded at plan time: ten lines, all under `tests/`) |
| AC3.1 | Task 1 Step 4 (eight importers); Task 2 Step 4 (the ninth) |
| AC4.1 | Task 2 Step 5 (mutation check) |
| AC5.1 | Task 1 Step 5 (`git log --follow`) |

## Self-Review

- **Spec coverage:** Deliverable 1 → Task 1 Steps 1, 3. Deliverable 2 → Task 2 Step 3. Deliverable 3 (nine requires and one comment) → Task 1 Step 1 (eight plus the comment), Task 2 Step 1 (one). Deliverable 4 → Task 2 Step 3. AC1 → Task 1 Step 5, Task 2 Step 4. AC2 → Task 2 Step 4. AC3 → Task 1 Step 4, Task 2 Step 4. AC4 → Task 2 Step 5. AC5 → Task 1 Step 5, Task 2 Step 6. AC6 → Folded verification.
- **Step scan:** every step names its exact edit or command and the output that means it passed.
- **Type consistency:** export names and require paths are the same in every step that names them (`./helpers/argument-hint`, `../../helpers/option-description.js`, `../../plugin/bin/lib/health-core/frontmatter-list`).
- **Review Focus:** five lines; items 2-5 are pinned by named steps, item 1 by the full suite.
- **Proportion:** the plan is about the length of the spec; the only code blocks are the two header comments the spec fixes.
