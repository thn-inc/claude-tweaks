# Remove resolve-refutation and the main() Shims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the unused `resolve-refutation` verb, `resolveRefutation`, and the unused `main()` shims in `design-detect.js` and `phase-timing.js`, together with the tests, pins and docs text that exist only for them.

**Architecture:** Straight deletion, no deprecation step: each removed item carries a recorded removal condition whose trigger has fired, and no caller exists. Three commits: the verb and library function with their tests and pins, the command-reference line, and the two shims.

**Tech Stack:** Node (CommonJS), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T231049-spec-5535-5542/spec-5535/work/5535-spec.md` (record #5535). Line numbers below were re-read in this worktree at `0f083c334`.

## Global Constraints

- Not in scope, do not touch: `resolve-debate` (still invoked by `plugin/skills/review/step3-debate-and-refutation.md:43`); the four health CLIs' `main()` shims (`code-health.js`, `docs-health.js`, `harness-health.js`, `journey-health.js` — record #5536); the `main` functions in `release-bootstrap.js` and `release-notes-publish.js`; `claude-tweaks-statusline.js`, `drive.js`, `hooks.js`, `verify.js`; `docs/plans/2026-11-15-in-process-health-sweep-clis-ledger.md`.
- `docs/incident-log.md:227` and archived run files mention the verb. They are history; leave them.
- `tests/review-tiebreak-step-conformance.test.js:599-600`, `:616-617` and `:685-697` forbid the retired verb in skill prose. They stay unedited.
- `git grep -E` with `\b` silently matches nothing on this machine. Use `-w`, `-F` or `-P`.
- Commit subjects use `{Verb} {what} — {detail}` (imperative, no conventional-commit prefix), with a `refs #5535` body line.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- From the project skill `removal-condition-execution` (quoted verbatim, these apply):
  - "Identifiers (the date, the step number, the guard's name) are what acceptance greps check. The concept the removed thing introduced has words of its own."
  - "A test title is a string literal no assertion reads, so it stays green while wrong"
  - "| a code comment, a test title, a test comment | rewrite; behavior unchanged unless the record says otherwise |"
  - "| a test assertion | re-anchor (a sentinel) or retarget (a pin), never only delete |"
  - "| `docs/incident-log.md`, `CHANGELOG.md`, archived run `work/*.md`, `docs/superpowers/plans/*` | leave: history, not live guidance |"
  - How the assertion row applies here: the three conformance rows removed in Task 1 pin the removal-condition comment and the "(unused since #3947)" docs clause, which are themselves deleted, so there is nothing to retarget them at. The fail-toward-scrutiny direction that `tests/multi-agent-coordination.test.js:1131` tested is already pinned for the live path by `tests/bin-lib/tiebreak.test.js:69` (empty reply), `:92` (missing verdict) and `:196` (malformed reply).
- From the project skill `gh-api-module-pattern` (`cli-wrapper-contract.md`, quoted verbatim, applied here to removing a verb): "Grep for an existing sibling instead: `git grep -n -F 'detect-overlap' -- plugin docs .claude/skills` finds every list of the verbs". Run at authoring time with the sibling `categorise-reproduction`: the lists of this CLI's verbs are the header comment and `USAGE` in `plugin/bin/review-coordination.js`, and `docs/plugin-structure.md:285`. `plugin/skills/review/code-mode-steps.md:275` lists `detect-overlap`/`resolve-debate`/`resolve-tiebreak` and already omits the verb.

## Authoring-time probes (recorded output)

- AC1's grep, control run on the unmodified tree: `git grep -n -e "resolve-refutation" -e "resolveRefutation" -- plugin/bin docs/plugin-structure.md` prints 12 lines — `docs/plugin-structure.md:285`, `plugin/bin/lib/coordination.js:561,572,638`, `plugin/bin/review-coordination.js:10,15,46,61,178,180,183,186`.
- Repo-wide sweep outside code, tests and history: `git grep -n -F -e resolve-refutation -e resolveRefutation -- . ':!docs/incident-log.md' ':!CHANGELOG.md' ':!tests' ':!plugin/bin' ':!docs/superpowers' ':!.claude-tweaks' ':!docs/plans'` prints only `docs/plugin-structure.md:285`. No hit under `.claude/skills`.
- No caller of either shim: `git grep -n -P "\.main\(|\bmain\s*[,}]|\{\s*main\b" -- plugin/bin tests tools perf evals scripts`, filtered to `design-detect|phase-timing`, prints only the two `module.exports` lines (`plugin/bin/design-detect.js:178`, `plugin/bin/phase-timing.js:421`).
- The retired verb today: `node plugin/bin/review-coordination.js resolve-refutation` exits 2 with `review-coordination.js: resolve-refutation takes exactly 1 verdict` and a usage block of 8 lines, one naming the verb.
- The removal condition's trigger: `gh api repos/thn-inc/claude-tweaks/issues/3950` reports `closed`, `completed`, `2026-10-24T16:42:24Z`.
- Each task's Step 2 probe was run once on the unmodified tree and exited 1.

## Review Focus

- Someone still runs `review-coordination.js resolve-refutation <verdict>` from an older habit or script: it must exit 2 as an unknown command with the usage text, not crash or print a resolution. Pinned by Task 1 Step 5.
- `resolve-debate`, the neighbouring verb sharing the reworded comment, must print the same three resolutions as before. Pinned by the existing `resolve-debate prints the bare resolution for every verdict combination` test, run in Task 1 Step 4.
- Skill prose must still be forbidden from naming the retired verb once the code that defined it is gone. Pinned by the unedited rows at `tests/review-tiebreak-step-conformance.test.js:599-617` and `:685-697`, run in Task 1 Step 4.
- `design-detect.js` and `phase-timing.js` run as real processes must still set their exit code once `main` is gone. Pinned by the existing real-process tests in `tests/bin-lib/design-detect/cli.test.js` and `tests/bin-lib/timing/cli.test.js`, run in Task 3 Step 5.
- Importers of `phase-timing.js`'s render helpers (`renderCiGate`, `renderMarkdown`) must be unaffected by the narrowed export list. Pinned by `tests/bin-lib/timing/ci-gate.test.js` and `tests/bin-lib/timing/golden.test.js`, run in Task 3 Step 5.

Waived AC6.1: the whole suite is run once by `/claude-tweaks:build` Common Step 5 through `verify.js` after all three tasks, not inside a task; each task runs the test files its change touches.
Waived docs/incident-log.md: history the spec says to leave; no task reads or edits it.

---

### Task 1: Remove the resolve-refutation verb and resolveRefutation

**Files:**
- Modify: `plugin/bin/review-coordination.js`
- Modify: `plugin/bin/lib/coordination.js`
- Test: `tests/bin-lib/review-coordination/cli.test.js`
- Test: `tests/multi-agent-coordination.test.js`
- Test: `tests/review-tiebreak-step-conformance.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `plugin/bin/lib/coordination.js` no longer exports `resolveRefutation`; `review-coordination.js` has seven verbs. Task 2 edits the docs line that lists them.

All five files change in one commit: `tests/review-tiebreak-step-conformance.test.js:1313` fails with "region not found" once the verb's `if` is gone, and `tests/multi-agent-coordination.test.js` calls `c.resolveRefutation`.

- [ ] **Step 1: Edit the three test files to the end state**

`tests/bin-lib/review-coordination/cli.test.js`: delete the test `'resolve-refutation: only the exact literal not-refuted keeps a finding confirmed'` (lines 95-99) and one of the blank lines around it.

`tests/multi-agent-coordination.test.js`, section "Refutation (Per-Candidate Refutation Pass, /review Step 3.5)". Keep the three-line section banner at 1103-1105.
  - Delete the comment block at 1107-1109 (the one saying `resolveRefutation` "stay[s] pinned here at the library level"; the spec cites it as 1105-1107).
  - Test at 1110: retitle to `"refutation: the can't-tell downgrade line matches the documented schema"` and delete its first line, `assert.strictEqual(c.resolveRefutation('refuted'), 'unconfirmed');`. The `entry` constant and the `assert.match(entry, decisionLogPattern(...))` line stay as they are.
  - Delete the tests at 1117, 1121 and 1131 entirely.
  - Test at 1143: retitle to `'/review Step 3.5: the review skill documents both the Per-Candidate Refutation Pass and Cross-Lens Debate'` (`REVIEW_SKILL` concatenates `SKILL.md`, `step3-lens-dispatch.md` and `step3-debate-and-refutation.md`, so the title names the skill, not one file). Delete everything in its body down to and including the "No silent drops" assertion (1144-1168). Keep, unchanged, the two-line comment at 1170-1171 and the two `assert.ok(REVIEW_SKILL.includes(...))` lines at 1172-1173.

`tests/review-tiebreak-step-conformance.test.js`:
  - Delete the `refutationVerb` slice (1313) and the three `FAILURE_PATHS` rows at 1349-1351.
  - Delete what those rows alone used: `COORDINATION_CLI` (1301), `PLUGIN_STRUCTURE` (1302), the `cli:` and `structure:` entries of `failurePathTexts` (1307-1308) and `coordinationCliDocLine` (1314). Confirm with `git grep -n -e "COORDINATION_CLI" -e "PLUGIN_STRUCTURE" -e "texts.cli" -e "texts.structure" -e "coordinationCliDocLine" -e "refutationVerb" -- tests/review-tiebreak-step-conformance.test.js` printing nothing.
  - Reword the comment at 1345 from `// Shared docs and the retired verb.` to `// Shared docs.`
  - Leave 599-600, 616-617 and 685-697 untouched.

- [ ] **Step 2: Run the probe to verify it fails**

Run: `node -e "process.exit('resolveRefutation' in require('./plugin/bin/lib/coordination') ? 1 : 0)"`
Expected: FAIL (exit 1 — the export still exists)

- [ ] **Step 3: Delete the verb and the library function**

`plugin/bin/review-coordination.js`:
  - Delete header line 10 (`//   node bin/review-coordination.js resolve-refutation <verdict>`).
  - Reword lines 15-16 so they describe `resolve-debate` alone: `// (corroborate-cross-lens: #3604); resolve-debate prints` / `// the bare resolution string. resolve-tiebreak/write-findings/check-coverage` (the second line is unchanged).
  - Delete `resolveRefutation,` from the `./lib/coordination` import (line 46).
  - Delete the `resolve-refutation <verdict>` line from `USAGE` (line 61).
  - Delete the whole `if (command === 'resolve-refutation') { … }` block (178-188), comment included.

`plugin/bin/lib/coordination.js`: delete the comment and function at 559-574 (from `// Sibling to resolveDebate, not an overload of it` through the closing `}` of `resolveRefutation`, leaving one blank line between `resolveDebate` and `buildReproductionDispatch`), and the `resolveRefutation,` export line (638).

- [ ] **Step 4: Run the tests and the probe to verify they pass (AC4.1, AC5.1)**

Run: `node -e "process.exit('resolveRefutation' in require('./plugin/bin/lib/coordination') ? 1 : 0)"`
Expected: exit 0

Run: `node --test tests/bin-lib/review-coordination/cli.test.js tests/multi-agent-coordination.test.js tests/review-tiebreak-step-conformance.test.js`
Expected: PASS, `fail 0`. AC4.1: the can't-tell decision-log line schema test and the two `REVIEW_SKILL` section-name assertions are among the passing tests of `tests/multi-agent-coordination.test.js`. AC5.1: `tests/review-tiebreak-step-conformance.test.js` passes, including the rows that forbid `resolve-refutation` in `plugin/skills`.

Run: `git grep -n -e "resolveRefutation" -- tests`
Expected: only `tests/review-tiebreak-step-conformance.test.js:600` and `:617` (line numbers unchanged: every edit in that file is below them), and no test title naming `resolveRefutation`.

- [ ] **Step 5: Verify the retired verb is an unknown command (AC2.1)**

Run: `node plugin/bin/review-coordination.js resolve-refutation`
Expected: exit code 2; stderr starts with `review-coordination.js: unknown command: resolve-refutation`, followed by a `usage:` block of seven lines, none containing `resolve-refutation`.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/review-coordination.js plugin/bin/lib/coordination.js tests/bin-lib/review-coordination/cli.test.js tests/multi-agent-coordination.test.js tests/review-tiebreak-step-conformance.test.js
git commit -m "Remove the resolve-refutation verb and resolveRefutation — unused since #3947, removal condition #3950 met" -m "refs #5535"
```

### Task 2: Drop the verb from the command reference

**Files:**
- Modify: `docs/plugin-structure.md:285`

**Interfaces:**
- Consumes: Task 1 removed the conformance row that pinned `` `resolve-refutation` (unused since #3947) `` on this line.
- Produces: nothing later tasks use.

- [ ] **Step 1: Confirm the line's two mentions**

Run: `git grep -c -F "resolve-refutation" -- docs/plugin-structure.md`
Expected: `docs/plugin-structure.md:1` (both mentions sit on line 285)

- [ ] **Step 2: Run the probe to verify it fails**

Run: `node -e "process.exit(require('fs').readFileSync('docs/plugin-structure.md', 'utf8').includes('resolve-refutation') ? 1 : 0)"`
Expected: FAIL (exit 1 — the line still names the verb)

- [ ] **Step 3: Edit line 285, two replacements and nothing else on the line**

  - `resolve-debate|resolve-refutation|resolve-tiebreak` becomes `resolve-debate|resolve-tiebreak`.
  - ``bare resolution string for `resolve-debate`/`resolve-refutation` (unused since #3947);`` becomes ``bare resolution string for `resolve-debate`;``.

- [ ] **Step 4: Verify the grep is empty and the docs-reading suites pass (AC1.1, AC1.2)**

Run: `git grep -n -e "resolve-refutation" -e "resolveRefutation" -- plugin/bin docs/plugin-structure.md`
Expected: no output, exit 1. AC1.1: it prints nothing. AC1.2: the same command printed eleven source lines and one docs line on the unmodified tree (recorded under Authoring-time probes).

Run: `node --test tests/review-tiebreak-step-conformance.test.js tests/timing-prose-conformance.test.js`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add docs/plugin-structure.md
git commit -m "Drop resolve-refutation from the command reference — the verb is removed" -m "refs #5535"
```

### Task 3: Remove the main() shims in design-detect.js and phase-timing.js

**Files:**
- Modify: `plugin/bin/design-detect.js:171-178`
- Modify: `plugin/bin/phase-timing.js:418-421`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `design-detect.js` exports `{ run, realDeps }`; `phase-timing.js` exports `{ run, realDeps, parseArgs, renderMarkdown, renderDispatches, renderCiGate }`.

No test file changes: no test imports or calls either `main`.

- [ ] **Step 1: Re-confirm no caller**

Run: `git grep -n -P "\.main\(|\bmain\s*[,}]|\{\s*main\b" -- plugin/bin tests tools perf evals scripts`
Expected: among the lines naming `design-detect` or `phase-timing`, only `plugin/bin/design-detect.js:178` and `plugin/bin/phase-timing.js:421`. Any other such line is a caller: stop and report it instead of deleting.

- [ ] **Step 2: Run the probe to verify it fails**

Run: `node -e "process.exit(['./plugin/bin/design-detect.js', './plugin/bin/phase-timing.js'].some((f) => 'main' in require(f)) ? 1 : 0)"`
Expected: FAIL (exit 1 — both modules still export main)

- [ ] **Step 3: Delete both shims**

`plugin/bin/design-detect.js`: delete the three-line `// Removal condition: …` comment, the `main` function and the blank line after it (171-177); the export line becomes `module.exports = { run, realDeps };`.

`plugin/bin/phase-timing.js`: delete the `// Kept for callers that import it. …` comment, the `main` function and the blank line after it (418-420); the export line becomes `module.exports = { run, realDeps, parseArgs, renderMarkdown, renderDispatches, renderCiGate };`. The `if (require.main === module)` block below it is unchanged.

- [ ] **Step 4: Verify the export lists (AC3.1, AC3.2)**

Run: `node -e "for (const f of ['./plugin/bin/design-detect.js', './plugin/bin/phase-timing.js']) console.log(f, Object.keys(require(f)).join(','))"`
Expected, exactly:
```
./plugin/bin/design-detect.js run,realDeps
./plugin/bin/phase-timing.js run,realDeps,parseArgs,renderMarkdown,renderDispatches,renderCiGate
```
AC3.1: neither list contains `main`. AC3.2: `run` and `realDeps` are in both, and `phase-timing.js` still exports `parseArgs`, `renderMarkdown`, `renderDispatches` and `renderCiGate`.

- [ ] **Step 5: Run the tests that load or spawn the two CLIs**

Run: `node --test tests/bin-lib/design-detect/cli.test.js tests/bin-lib/timing/cli.test.js tests/bin-lib/timing/ci-gate.test.js tests/bin-lib/timing/golden.test.js tests/bin-lib/cli-entry-conformance.test.js`
Expected: PASS, `fail 0`

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/design-detect.js plugin/bin/phase-timing.js
git commit -m "Remove the main() shims in design-detect.js and phase-timing.js — no importer remains" -m "refs #5535"
```

---

## After the tasks (controller, not an implementer task)

- Record the scratch checks for AC1, AC2 and AC3 as `AC evidence` entries in the run's `decisions.md`, with their output under the run directory's `evidence/`.
- State in the pull request that this reverses ledger row 19's ruling in `docs/plans/2026-11-15-in-process-health-sweep-clis-ledger.md` ("keep design-detect's exported main though its removal condition is already met"), citing `docs/superpowers/specs/2026-11-15-audit-simplification-design.md` (unit 1.2), and report the removal-condition checks: #3950's state and the caller greps above.
