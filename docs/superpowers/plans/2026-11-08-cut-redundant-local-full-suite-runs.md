# Cut Redundant Local Full-Suite Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inside claude-tweaks pipelines, run the full test suite once per branch (Common Step 5) instead of once per plan task plus a worktree baseline run.

**Architecture:** Prose-only changes to shipped skill files that compose instructions for superpowers skills (`build/dispatch.md`, `build/SKILL.md`, `build/worktree-setup.md`, `build/build-options.md`) and for dispatched Task agents (`dispatch/task-prompt.md`, `dispatch/express-prompt.md`), plus four new upstream-drift pins in `tools/upstream-drift/manifest.yml` and one new `node --test` conformance suite.

**Tech Stack:** Markdown skill prose; Node 18+ `node --test`; YAML manifest.

**Spec:** `.claude-tweaks/pipelines/2026-11-08T122847-spec-5117/work/5117-spec.md` (record #5117)

Scope keywords: `baseline test verification`, `Verify Clean Baseline`, `full suite once before committing`

## Global Constraints

- Standalone `/claude-tweaks:build` (no `$PIPELINE_RUN_DIR`) keeps the superpowers worktree baseline run — only pipeline runs skip it.
- TDD red/green focused runs are unchanged; only the per-task *full-suite* run becomes the affected set.
- Common Step 5 (`verify.js`) stays the single full-suite run and the only pass-stamp producer.
- The Foreground execution paragraph in `dispatch/task-prompt.md`'s first-call template and both `dispatch/express-prompt.md` templates must stay equal after whitespace normalization (`tests/dispatch-express-routing-prose.test.js`).
- `plugin/skills/dispatch/task-prompt.md` is 52,394 LF bytes against the 52,500-byte Read rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`): net growth there must stay under 100 bytes. `plugin/skills/build/SKILL.md` is 52,274 LF bytes: net growth under 200 bytes. Rule text goes in `build/dispatch.md` (46,784 bytes); the two near-rail files get only pointers.
- Hand-written commit subjects follow `{Verb} {what} — {detail}`; every commit message ends with `refs #5117` and the `Claude-Session:` trailer line from the run.

## Review Focus

1. A consumer project whose test command is not `npm test` (Go, Python): no shipped dispatch prompt may still instruct `npm test` — Task 3's test pins absence in all three prompt files.
2. A cross-cutting task with no obvious owning tests: the affected-set rule must say what to run then (tests scoped to the touched packages/paths), not leave the implementer to fall back to the whole suite — Task 1's test pins that wording.
3. A standalone `/build` (no run dir): must still run the baseline — Task 2's test pins the `$PIPELINE_RUN_DIR`-scoped condition and the standalone carve-out.
4. The batched strategy (`/superpowers:executing-plans`): must get the same rule, not only SDD — Task 1's test pins the SKILL.md pointer.
5. An upstream superpowers rewording silently re-enabling the overridden runs: Task 4 pins each overridden line in the manifest, and a test asserts every pin is present.

---

### Task 1: Affected-set rule for implementers, fix wave and batched execution

**Files:**
- Modify: `plugin/skills/build/dispatch.md` (line 14, the **subagent** paragraph)
- Modify: `plugin/skills/build/SKILL.md` (Common Step 2, the `**batched**:` line)
- Modify: `tests/plan-task-markers-conformance.test.js:78`
- Create: `tests/pipeline-test-scope-conformance.test.js`

**Interfaces:**
- Produces: `tests/pipeline-test-scope-conformance.test.js` with constants `PLUGIN`, `BUILD_DISPATCH`, `BUILD_SKILL`, reading via `tests/helpers/read-skill.js`'s `readText`; Tasks 2-4 append their own `test(...)` blocks to this file.

- [ ] **Step 1: Write the failing tests** in `tests/pipeline-test-scope-conformance.test.js` (header comment naming #5117 and the K+3 → 1 full-run motivation). Use `missingFactsOf` + `assertEachPatternGoesRed` from `tests/helpers/conformance-asserts.js`. Test `build/dispatch.md carries the affected-set rule (#5117)` with facts (each `\s+` absorbs wrapping; each must match exactly once in dispatch.md):
  - `/\*\*Affected-set testing \(#5117\)\.\*\*/` — the rule is labeled
  - `/per-task implementer, fix-wave and whole-branch-fix dispatch run the affected test set/` — covers implementers and the fix wave
  - `/run the full suite once before committing/` — names the SDD line it replaces
  - `/scoped to the touched packages or paths/` — the cross-cutting fallback
  - `/Common Step 5 runs the full suite once for the branch/` — single full run
  Test `build/dispatch.md's foreground instruction names the project's test command`: matches `/run the project's test command and every other long-running command in the foreground of that turn/`.
  Test `build/SKILL.md's batched line folds in the affected-set rule`: the line starting `**batched**: Invoke` matches `/affected-set rule \(#5117\)/`.
  Each fact-list test gets a go-red proof (`assertEachPatternGoesRed(text, FACTS, missingFactsOf(FACTS))`).
- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/pipeline-test-scope-conformance.test.js`
  Expected: FAIL — `**Affected-set testing (#5117).**` not found.
- [ ] **Step 3: Edit `plugin/skills/build/dispatch.md` line 14.** (a) Replace ``run `npm test` and every other long-running command`` with `run the project's test command and every other long-running command`. (b) Insert, immediately after the `**Source-scan suites for plugin/bin/ work (#4421):**` group's last sentence ("…surfaces only at Common Step 5's full run."): `**Affected-set testing (#5117).** In the same invocation instruction, also direct it to have every per-task implementer, fix-wave and whole-branch-fix dispatch run the affected test set — the tests covering the files it changed, scoped to the touched packages or paths (e.g. one test file, or one Go package tree) — in place of SDD's "run the full suite once before committing" and test-driven-development's "Other tests means the project's suite"; TDD's red/green runs are unchanged. Common Step 5 runs the full suite once for the branch, through verify.js: a per-task full run duplicates it, and with several pipelines on one machine each one is another machine-sized worker pool.` (c) In `tests/plan-task-markers-conformance.test.js:78`, change the regex to `/run the project's test command and every other long-running command in the foreground of that turn/`.
- [ ] **Step 4: Edit `plugin/skills/build/SKILL.md`'s `**batched**:` line** — after ``Invoke `/superpowers:executing-plans`.`` insert ` Fold in dispatch.md's affected-set rule (#5117) — it replaces executing-plans' per-task and final whole-suite runs.` (≤120 bytes).
- [ ] **Step 5: Run to verify it passes**
  Run: `node --test tests/pipeline-test-scope-conformance.test.js tests/plan-task-markers-conformance.test.js tests/foreground-execution-instruction.test.js`
  Expected: PASS, 0 failures.
- [ ] **Step 6: Commit** the four files; subject `Scope per-task test runs to the affected set — Common Step 5 stays the one full run`.

### Task 2: Skip the superpowers worktree baseline run inside pipelines

**Files:**
- Modify: `plugin/skills/build/worktree-setup.md:148` (Procedure step 3)
- Modify: `plugin/skills/build/build-options.md:13` (Git row)
- Test: `tests/pipeline-test-scope-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's test file and its read helper.

- [ ] **Step 1: Write the failing test** `build/worktree-setup.md skips the baseline run inside a pipeline (#5117)` over the Procedure's step 3 line (`lineStartingWith(sectionOf(text, '## Procedure'), '3. ')`), facts:
  - `/Verify Clean Baseline/` — names the upstream step
  - `/\$PIPELINE_RUN_DIR` is set/` — pipeline-scoped
  - `/before Step 4's catch-up/` — the stale-tree reason
  - `/Standalone `\/build` keeps the baseline run/` — standalone carve-out
  plus a go-red proof; and `build-options.md`'s Git row matches `/baseline test run \(skipped inside a pipeline\)/`.
- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/pipeline-test-scope-conformance.test.js`
  Expected: FAIL on the worktree-setup facts.
- [ ] **Step 3: Rewrite step 3** to: ``3. The skill handles branch creation and dependency install. **Skip its baseline test run inside a pipeline (#5117):** when `$PIPELINE_RUN_DIR` is set, direct it in the same invocation to skip its "Step 3: Verify Clean Baseline" — that run lands before Step 4's catch-up, so it tests a tree Common Step 5 re-verifies after catch-up, and Common Step 5's `verify.js` run with baseline adjudication owns pre-existing failures. Standalone `/build` keeps the baseline run.`` In `build-options.md:13` replace `with dependency install and baseline test verification` with `with dependency install and a baseline test run (skipped inside a pipeline)`.
- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/pipeline-test-scope-conformance.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit** the three files; subject `Skip the superpowers worktree baseline run inside pipelines — Common Step 5 owns it`.

### Task 3: Project test command in shipped dispatch prompts

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md` (lines 157, 255, 347)
- Modify: `plugin/skills/dispatch/express-prompt.md` (lines 31, 131)
- Test: `tests/pipeline-test-scope-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's test file.

- [ ] **Step 1: Write the failing test** `no shipped dispatch prompt instructs a literal npm test (#5117)`: for each of `build/dispatch.md`, `dispatch/task-prompt.md`, `dispatch/express-prompt.md`, assert the text contains no `` `npm test` `` span; and each `Foreground execution (required):` paragraph in task-prompt.md and express-prompt.md matches `/run the project's test command and every other long-running command/` after whitespace normalization. Go-red: substituting the old phrase back into the read text makes the absence assertion fail.
- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/pipeline-test-scope-conformance.test.js`
  Expected: FAIL — task-prompt.md still contains `npm test`.
- [ ] **Step 3: Edit the prompts.** In all four Foreground execution paragraphs replace ``run `npm test` and every other long-running command in the`` with `run the project's test command and every other long-running command in the` (re-wrap only if needed; whitespace-normalized equality between templates must hold). In `task-prompt.md:254-255` replace ``A raw`` / `` `npm test` log`` with `A raw` / `test-command log`. Confirm `task-prompt.md` stays under 52,500 LF bytes.
- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/pipeline-test-scope-conformance.test.js tests/foreground-execution-instruction.test.js tests/dispatch-express-routing-prose.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit** the three files; subject `Name the project's test command in dispatch prompts — npm test is wrong for non-Node consumers`.

### Task 4: Pin the overridden superpowers lines

**Files:**
- Modify: `tools/upstream-drift/manifest.yml` (superpowers entry: `contract-paths`, `assertions`)
- Test: `tests/pipeline-test-scope-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's test file.

- [ ] **Step 1: Write the failing test** `manifest.yml pins every superpowers line #5117 overrides`: read `tools/upstream-drift/manifest.yml` and assert each `must-match` value below appears exactly once, on the line after its `upstream-path`:
  - `skills/subagent-driven-development/implementer-prompt.md` — `full suite once before committing, not after every edit.`
  - `skills/test-driven-development/SKILL.md` — `means the project's suite, not just your file.`
  - `skills/using-git-worktrees/SKILL.md` — `## Step 3: Verify Clean Baseline`
  - `skills/executing-plans/SKILL.md` — `make it pass, then run the whole suite.`
  and `contract-paths` lists `skills/test-driven-development/SKILL.md` and `skills/executing-plans/SKILL.md`.
- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/pipeline-test-scope-conformance.test.js`
  Expected: FAIL — pins absent.
- [ ] **Step 3: Add the pins.** Append `skills/test-driven-development/SKILL.md` and `skills/executing-plans/SKILL.md` to the superpowers `contract-paths`. Append four assertions after the last superpowers assertion, each `claims:` starting `will rely on (record #5117):` — files: `plugin/skills/build/dispatch.md` (implementer-prompt line; and the TDD line), `plugin/skills/build/worktree-setup.md` (baseline heading), `plugin/skills/build/SKILL.md` (executing-plans line). Must-match strings exactly as in Step 1; the TDD one contains an apostrophe — double-quote it.
- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/pipeline-test-scope-conformance.test.js tools/upstream-drift/tests/manifest.test.js`, then the upstream-drift runner's read-only assertion mode (`node tools/upstream-drift/run.js --help` names it) for superpowers.
  Expected: tests PASS; every superpowers assertion reports its must-match found in the installed 7.0.0.
- [ ] **Step 5: Commit** the two files; subject `Pin the superpowers test-run lines pipelines now override — drift re-enables nothing silently`.

---

## Acceptance-criterion coverage

- AC1 (dispatch.md affected-set rule, Common Step 5 as single full run) — Task 1 Step 1.
- AC2 (batched executing-plans carries the rule) — Task 1 Step 1 (SKILL.md pointer test).
- AC3 (worktree-setup skips the baseline when `$PIPELINE_RUN_DIR` is set; standalone unchanged) — Task 2 Step 1.
- AC4 (no literal `npm test` instruction in shipped dispatch prompts) — Task 3 Step 1.
- AC5 (manifest pins both surfaces; upstream-drift checks pass) — Task 4 Steps 1 and 4.
- AC6 (conformance tests pin the prose and can go red) — every task's Step 1 go-red proof.

## Governing project skills

- `.claude/skills/skill-prose-conformance-tests/SKILL.md`: "New prose has no pre-change bytes — mutate the live text in memory, and match the failure to its own assertion." Tasks 1-2 use `assertEachPatternGoesRed` over the live text. Task 3's absence assertion is the other direction — its control is a frozen pre-change excerpt (the old `Foreground execution (required): run `npm test` and every other` line) that the absence regex must match, so the absence check is proven discriminating, not vacuous.
