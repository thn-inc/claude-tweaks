# build/plan-authoring-checks: enumerate every test caller when a task adds a dependency to an existing function (#3115) Implementation Plan

**Goal:** Add a Dependency-caller enumeration check to `plan-authoring-checks.md`, directly after the Consumer-enumeration check.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T165338-spec-3115/work/3115-spec.md` (materialized from GitHub issue #3115)

---

### Task 1: Add the Dependency-caller enumeration check paragraph

**Files:**
- Modify: `plugin/skills/build/plan-authoring-checks.md`

- [ ] **Step 1: Failing test** — none: no test pins this file's check list today (`grep -rln plan-authoring-checks tests/` is empty) and the spec's Acceptance Criteria require only the prose and a green `npm test`. Verify the ACs with the greps in Step 3 instead.
- [ ] **Step 2: Implement** — insert one new bold paragraph immediately after the `**Consumer-enumeration check:**` paragraph (line 51), as its own paragraph separated by a blank line, headed `**Dependency-caller enumeration check (extends the Consumer-enumeration check):**`. It must state, in the file's existing one-paragraph style:
  - Trigger: a plan task adds an external dependency or side effect to an existing function — a store, network or filesystem read, a new stage or subprocess, a new required environment variable or config key.
  - Action: grep every test directory in the repo (not only the function's own test module) for callers of that function, following wrappers one level up (a test calling a wrapper hits the same dependency) or naming the affected test command; list each caller module in the task's Files block (`Modify:`/`Test:`) together with the stub or fixture it needs.
  - Why: a per-task review compares the task's diff against its own brief, so an unlisted caller module in another test file passes every task review and fails only at the whole-branch review or in CI. Archetype (project-neutral, one sentence, matching the file's style): a configuration-store read added to an export job's entry point, stubbed only in that entry point's own test module, while two CI-allowlisted cases in another test module reached the real store — caught only by the whole-branch review's focused test run, at the cost of one Critical finding, one fix-wave item and a ~30-minute local re-run.
  - Check B hook: `Scope keywords:` can name the function so Check B's fs-walk surfaces caller test files the plan's task list omitted.
  - The Consumer-enumeration check paragraph stays byte-identical.
- [ ] **Step 3: Run** — `grep -n "Dependency-caller enumeration check" plugin/skills/build/plan-authoring-checks.md` shows the new paragraph directly after line 51's paragraph; `git diff` shows only added lines; `node --test tests/bin-lib/skill-audit/*.test.js` passes.
- [ ] **Step 4: Commit** — one commit, `refs #3115`.

---

## Self-review

- **Spec coverage:** Deliverable 1 and all six Acceptance Criteria are covered (AC 6 by Common Step 5's full suite).
- **Placeholders:** none.
