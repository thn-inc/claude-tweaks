# SDD Final-Review Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/build`'s SDD invocation instruction makes SDD write its final whole-branch review (findings, reviewed commit, fix range, re-review verdicts) to `$PIPELINE_RUN_DIR/sdd-final-review.md` before Finish, carries SDD 7.0.0's `Ruling:` ledger lines into the run ledger, and names SDD's real `## Finish` section.

**Architecture:** Prose-only change to one paragraph of `plugin/skills/build/dispatch.md` (line 14, one long line) plus conformance tests that pin the new sentences by regex, each with an in-test doctored-text go-red control (the `tests/activity-never-invent-conformance.test.js` pattern).

**Tech Stack:** Markdown skill prose; `node --test` conformance tests reading the skill via `tests/helpers/read-skill`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T111000-spec-3376-3386/spec-3386/work/3386-spec.md` (record #3386), plus run-ledger rows 4 and 5 of `docs/plans/2026-10-17-spec-3376-3386-ledger.md` (scope-creep: add-to-plan — same paragraph).

## Global Constraints

- The file is `$PIPELINE_RUN_DIR/sdd-final-review.md` — the absolute run-directory path, never worktree-relative (`plugin/skills/_shared/pipeline-run-dir.md`, `[IL-127]`).
- Four captured items, verbatim where the spec says verbatim: the final reviewer's findings verbatim with their severities; the commit SHA the final reviewer's review package covered (HEAD at dispatch); the fix wave's commit range (`FIX_BASE..HEAD`), or "no fix wave"; the scoped re-review's per-finding verdicts verbatim.
- Written before Finish deletes the workspace; nothing written for standalone `/build` (no `$PIPELINE_RUN_DIR`) or when the whole-branch review was skipped (dispatch.md's own "Single-task fast-lane skip").
- Evidence, not a gate: no skill may block on the file's absence.
- Non-Goals: no change to SDD's final review, fix wave or re-review; nothing about per-task review output; no decision about #3381.
- Keep each edit to its own sentence block (dispatch.md is shared with #3118, #3004, #2869, #3378).
- Byte budget: dispatch.md is 15,224 B; the only binding ceiling is `tests/ceremony-profile-roster.test.js`'s `CEILING_BYTES` (51,200) — checked by grepping `tests/` for `dispatch.md` beside `byteLength`/`wc -c`; that test is the only hit.
- Run-dir artifact enumeration: `git grep -n "sdd-dispatch-sample" -- 'docs/*.md' 'plugin/*.md' 'plugin/*.js' 'tests/*.js'` (excluding plans/ledgers) returns only `plugin/skills/build/dispatch.md` and `tests/build-ac-forwarding-verification.test.js` — no doc (`docs/hooks.md`, `_shared/pipeline-run-dir.md`) enumerates run-dir artifacts, so no enumeration needs the new file.
- SDD 7.0.0 facts (cache `~/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0/skills/subagent-driven-development/SKILL.md`): `## Final Review` (line 445) packages `MERGE_BASE..HEAD`, then ONE fix subagent, then one scoped re-review over `FIX_BASE..HEAD` (line 463); `## Finish` (line 471) collects every ledger line containing `Ruling:` into "Rulings I made", then `rm -rf <workspace>`. Ruling line shapes: `Task <N>: parked — <finding> — Ruling: <why>` (416), `Task <N>: Ruling: <finding> — <what you decided and why>` (422), bare `Ruling: ...` (23).

## Review Focus

1. A `progress.md` line that carries two markers — `Task 3: parked — X — Ruling: Y` — must reach the ledger once, not twice: the carry-forward states that a line matching more than one marker is copied once, under its first match in the order `minor (deferred):`, `parked —`, `Ruling:` (Task 2's test pins the sentence).
2. A run whose whole-branch review was skipped (fast-lane single task) must write no `sdd-final-review.md` rather than an empty or misleading one (Task 1's test pins the skip sentence).
3. A final review with zero findings still has a reviewed commit: the file is written whenever the review was dispatched, and the fix-range item reads "no fix wave" (Task 1's test pins "no fix wave").
4. A worktree-relative `$PIPELINE_RUN_DIR` would shadow the main-checkout run dir: the instruction says the absolute run-directory path (Task 1's test pins it).
5. A later reader treating the file as a gate: the instruction states nothing blocks on its absence (Task 1's test pins it).

---

### Task 1: Persist SDD's final whole-branch review (#3386)

**Files:**
- Modify: `plugin/skills/build/dispatch.md:14` — insert one new bold-led sentence block immediately after the carry-forward block (after "…from being lost at that seam.") and before "**Standing AC-forwarding verification (#496).**"
- Create: `tests/build-sdd-final-review-capture.test.js`

**Interfaces:**
- Produces: the sentence block below, verbatim (Task 2 does not touch it).

- [ ] **Step 1: Write the failing test** `tests/build-sdd-final-review-capture.test.js`, header comment naming #3386 in the style of `tests/build-sdd-ledger-residue-carryforward.test.js`, reading `plugin/skills/build/dispatch.md` via `readText`. Tests (each regex applied to the file text):
  - `'dispatch.md: SDD invocation directs the final-review capture before Finish deletes the workspace (#3386 AC1)'` — matches `/\*\*Persist SDD's final whole-branch review before Finish \(#3386\):\*\*/` and `/before deleting the plan's workspace, it must write `\$PIPELINE_RUN_DIR\/sdd-final-review\.md` \(the absolute run-directory path, never a worktree-relative one\)/`
  - `'dispatch.md: the capture names the four items (#3386 AC1)'` — matches each of `/the final reviewer's findings verbatim with their severities/`, `/the reviewed commit SHA \(HEAD when the final review's package was built\)/`, `/the fix wave's commit range \(`FIX_BASE\.\.HEAD`\), or "no fix wave"/`, `/the scoped re-review's per-finding verdicts verbatim/`
  - `'dispatch.md: nothing is written for standalone /build or a skipped whole-branch review (#3386 AC2)'` — matches `/Write nothing for a standalone `\/build` \(no `\$PIPELINE_RUN_DIR`\) or when the whole-branch review was skipped/`
  - `'dispatch.md: the capture is evidence, not a gate'` — matches `/nothing blocks on its absence/`
  - `'doctored control: removing the reviewed-commit item turns the AC1 assertion red (#3386 AC3)'` — `doctored = text.replace(/the reviewed commit SHA \(HEAD when the final review's package was built\); /, '')`; assert `/the reviewed commit SHA \(HEAD when the final review's package was built\)/.test(doctored) === false` and that `doctored !== text` (the replace actually hit).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-sdd-final-review-capture.test.js`
Expected: FAIL — the first four tests fail (no such sentence yet); the doctored control fails on `doctored !== text`.

- [ ] **Step 3: Insert the sentence block** into dispatch.md line 14 at the position named above, exactly:

```
**Persist SDD's final whole-branch review before Finish (#3386):** in the same invocation instruction, also direct `/superpowers:subagent-driven-development` that, when its final whole-branch review was dispatched, at its own Finish step — before deleting the plan's workspace, it must write `$PIPELINE_RUN_DIR/sdd-final-review.md` (the absolute run-directory path, never a worktree-relative one) containing: the final reviewer's findings verbatim with their severities; the reviewed commit SHA (HEAD when the final review's package was built); the fix wave's commit range (`FIX_BASE..HEAD`), or "no fix wave"; and the scoped re-review's per-finding verdicts verbatim. It is maintainer evidence for #3381's double-review measurement — nothing blocks on its absence. Write nothing for a standalone `/build` (no `$PIPELINE_RUN_DIR`) or when the whole-branch review was skipped (the Single-task fast-lane skip below).
```

Keep the single-line paragraph shape (one space before and after the block, no line break).

- [ ] **Step 4: Verify AC1.1, AC2.1 and AC3.1 — run the tests**

Run: `node --test tests/build-sdd-final-review-capture.test.js tests/build-sdd-ledger-residue-carryforward.test.js tests/ceremony-profile-roster.test.js`
Expected: PASS, `# fail 0` — the AC1 tests cover AC1.1, the AC2 test covers AC2.1, and the doctored control plus the AC1/AC2 tests cover AC3.1. AC4.1 (`npm test` passes) is verified by `/build`'s Common Step 5 full-suite run after both tasks, not by a task.

- [ ] **Step 5: Commit**

```bash
git -C "<worktree>" add plugin/skills/build/dispatch.md tests/build-sdd-final-review-capture.test.js
git -C "<worktree>" commit -m "Direct SDD to persist its final whole-branch review to sdd-final-review.md before Finish (refs #3386)"
```

### Task 2: Carry `Ruling:` lines forward and name SDD's Finish step (ledger rows 4, 5)

**Files:**
- Modify: `plugin/skills/build/dispatch.md:14` — the "Carry forward surviving SDD ledger residue before Finish" block, and the two "Cleanup step" phrases in the "Standing AC-forwarding verification (#496)" block
- Modify: `tests/build-sdd-ledger-residue-carryforward.test.js` (regexes 2 and 3; two new tests)
- Modify: `tests/build-ac-forwarding-verification.test.js` (lines 14, 18, 23: Cleanup → Finish)

**Interfaces:**
- Consumes: Task 1's block sits between the carry-forward block and the #496 block — do not edit it.

- [ ] **Step 1: Update the tests first.** In `tests/build-sdd-ledger-residue-carryforward.test.js`:
  - regex in `'…names the source lines…'` becomes `/<workspace>\/progress\.md` line matching `minor \(deferred\):`, `parked —`, or `Ruling:`/` (rename the test to mention `Ruling:`);
  - regex in `'…names the destination…'` becomes `/this build's own open items ledger \(`\/claude-tweaks:ledger`'s Add Item operation\) — phase `build`, status `deferred` for a `minor \(deferred\):` line or `observation` for a `parked —` or `Ruling:` line/`;
  - new test `'dispatch.md: a line carrying two markers is copied once, under its first match'` — matches `/a line matching more than one marker is copied once, under its first match in that order/`;
  - new test `'dispatch.md: the carry-forward states why Ruling: lines matter under SDD 7.0.0'` — matches `/SDD 7\.0\.0 ledgers its pre-flight, fix-loop breaker and final-review decisions as `Ruling:` lines instead of stopping for the human/`.
  In `tests/build-ac-forwarding-verification.test.js`: line 23's regex becomes `/so it survives past SDD's own Finish step/`; update the line-14 comment and line-18 test title from "Cleanup step" to "Finish step". Add one test there: `'#496 wording: dispatch.md never names a nonexistent SDD "Cleanup step"'` — `assert.equal(/Cleanup step/.test(DISPATCH_TEXT), false)` (read the file the way that test file already does).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/build-sdd-ledger-residue-carryforward.test.js tests/build-ac-forwarding-verification.test.js`
Expected: FAIL — the four changed/new carry-forward assertions and the two Finish-step assertions fail.

- [ ] **Step 3: Edit dispatch.md line 14.**
  - In the carry-forward block, replace `` matching `minor (deferred):` or `parked —` into `` with `` matching `minor (deferred):`, `parked —`, or `Ruling:` into ``.
  - Replace `` status `deferred` for a `minor (deferred):` line or `observation` for a `parked —` line, using `` with `` status `deferred` for a `minor (deferred):` line or `observation` for a `parked —` or `Ruling:` line — a line matching more than one marker is copied once, under its first match in that order — using ``.
  - After "…from being lost at that seam." (and before Task 1's block), append: `` SDD 7.0.0 ledgers its pre-flight, fix-loop breaker and final-review decisions as `Ruling:` lines instead of stopping for the human, and `/build` suppresses `/superpowers:finishing-a-development-branch` — the channel SDD names for residual load-bearing findings — so a ruling not copied here reaches no durable record. ``
  - In the #496 block: `routinely swept by its Cleanup step` → `routinely swept by its Finish step`; `survives past SDD's own Cleanup step` → `survives past SDD's own Finish step`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/build-sdd-ledger-residue-carryforward.test.js tests/build-ac-forwarding-verification.test.js tests/build-sdd-final-review-capture.test.js tests/ceremony-profile-roster.test.js tests/build-dispatch-status-token-and-tree-immutability.test.js tests/foreground-execution-instruction.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git -C "<worktree>" add plugin/skills/build/dispatch.md tests/build-sdd-ledger-residue-carryforward.test.js tests/build-ac-forwarding-verification.test.js
git -C "<worktree>" commit -m "Carry SDD 7.0.0 Ruling: lines into the run ledger and name SDD's Finish step (refs #3386)"
```
