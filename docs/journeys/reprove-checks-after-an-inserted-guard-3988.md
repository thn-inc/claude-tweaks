---
files:
  - plugin/skills/build/plan-authoring-checks.md
  - plugin/skills/build/plan-authoring-boundary-checks.md
  - plugin/skills/build/dispatch.md
---

# Re-prove Checks After an Inserted Guard

**Persona:** A `/claude-tweaks:build` session, maintainer or agent, finalizing a plan or running the SDD fix loop, whose fix inserts a precondition guard ahead of checks that already exist.
**Goal:** Keep the downstream checks' tests able to catch a regression after the new guard starts rejecting their fixtures first. A fix that vacuates its neighbours' tests should not pass review as ADDRESSED.
**Entry point:** the plan-authoring checks before a plan is finalized. The guidance is `plan-authoring-checks.md`'s **Inserted-guard re-proof check (extends the Guard-branch discrimination check)**, which sits directly after the check it extends. During execution, the entry point is the SDD re-review `/claude-tweaks:build` composes, which carries `dispatch.md`'s **Downstream re-proof after an inserted guard (#3988)** instruction.
**Success state:** The plan names every check downstream of the new guard, and each one's test is shown red with that check mutated, not only the new guard. A re-review marks the fix ADDRESSED only after showing the same.

## Steps

### 1. Spot the inserted guard
- **URL:** the plan task, or the fix diff, read against `plan-authoring-checks.md`'s Guard-branch discrimination check and the Inserted-guard re-proof check after it.
- **Action:** Find any new early return, null check, tolerance gate, or similar precondition the fix places ahead of a check that was already there. List the checks that now run after it.
- **Should feel:** Like reading a function top to bottom once and listing what comes after the new line, a short list.
- **Should understand:**
  - The Guard-branch discrimination check proves the new guard is needed. This check proves the guards and checks behind it still do something.
  - A fixture that the new guard now rejects first never reaches the checks after it. Their tests stay green even with those checks deleted.
- **Red flags:**
  - A plan that tests only the new guard and treats the existing tests as untouched coverage.

### 2. Re-prove each downstream check by mutating it
- **URL:** a scratch copy or a scratch `git worktree add`, never the shared worktree.
- **Action:** For each downstream check, delete or invert that check alone, run its test, and record the red output in the plan. If the test stays green, give it a fixture that passes the new guard and reaches the check.
- **Should feel:** Mechanical. One mutation and one red run per check.
- **Should understand:**
  - #3945's F2 fix wave put the ±5-line evidence guard ahead of `plugin/bin/lib/tiebreak.js`'s past-EOF guard and window check. Their tests stopped catching a regression there, and deleting either check left the suite green.
- **Red flags:**
  - A mutation of the new guard offered as proof for the checks behind it.
  - A downstream test that stays green under its own check's mutation.

### 3. Hold the re-review to the same proof
- **URL:** the SDD scoped re-review of a fix round, or of the final review's fix wave, dispatched under `/claude-tweaks:build`.
- **Action:** The re-reviewer names each check downstream of the inserted guard and shows its test going red with that check mutated, in the scratch worktree the tree-immutability rule requires.
- **Should feel:** Like a short extra table in the re-review, one row per downstream check.
- **Should understand:**
  - In #3945, the scoped re-review still marked F2 ADDRESSED while the downstream tests were vacuous. This instruction is what blocks that verdict.
- **Red flags:**
  - An ADDRESSED verdict with no downstream red run quoted.

### 4. Pick up the cross-boundary checks when they apply
- **URL:** `plan-authoring-checks.md`'s **Cross-boundary checks:** pointer, then `plan-authoring-boundary-checks.md`.
- **Action:** When the plan adds a consumer whose producer ships through a different deployment path, or asserts a semantic about a schema this project does not own, follow the pointer and run the matching check.
- **Should feel:** Like an optional detour that few plans take.
- **Should understand:**
  - The Producer-freshness and Upstream-schema premise checks moved out of the main file in #3988, so the main file stays under the Read-limit rail with room for this record's rule.
- **Red flags:**
  - A deploy-ordering or foreign-schema plan finalized without opening the sub-file.

## Origin
- Created during the build of #3988, a reflect hindsight finding from #3945 (squash `f007f1c32`, PR #3954): the sdd-final-review residual (c) and ledger row 12 of spec-3945.
- Pinned by `tests/plan-authoring-inserted-guard-reprove-prose.test.js`, which pins both rule texts, their positions, the go-red controls, and the cross-boundary move.
- Related: `probe-a-substituted-command-with-an-empty-value-3592.md`, which made the same kind of sub-file move for the pairing-loop checks.
