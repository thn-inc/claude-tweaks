# Queue pull: with no integration-branch key and a failing git remote show, target-missing excludes every named-target candidate (#5305) Implementation Plan

**Goal:** An unresolvable integration branch (no `integration-branch` policy key, and `git remote show origin` failing) is a Warning that skips the branch-dependent passes cleanly — never a `git cat-file -e origin/:{path}` comparison that excludes every named-target candidate — in both the queue-pull module and the retained fence script.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5305/work/5305-spec.md` (materialized from GitHub issue #5305)

---

### Task 1: Skip the branch-dependent passes with a Warning when no integration branch resolves

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` — `runTargetMissing` (~750-800): today `branch` falls back to `remoteHeadBranch(ctx)`, which yields `''` on a failed git, and `ref` becomes `origin/`.
- Modify: `plugin/skills/dispatch/queue-pull-script.md` — the retained fence (#5231 has not removed it; ~384-466, `INTEGRATION_BRANCH=$(git remote show origin | sed ...)` at ~394); the record's Current State requires fixing both and keeping the parity row. Size headroom: measure `wc -c` on the file as it stands when this task starts (sibling records in this bundle edit it too — it was 52,345 bytes at plan review) against `RAIL_BYTES` 52,500 (`plugin/bin/lib/skill-audit/budgets.js`); keep it at or under 52,500 by trimming fence prose (comments, never behavior) to offset any bytes the fix adds. Never trim the `_shared/integration-branch.md` citation near the fence's `remote show origin` line — it is the file's only one, and `tests/integration-branch-conformance.test.js` requires it.
- Test: `tests/bin-lib/dispatch/queue-pull.test.js`

- [ ] **Step 1: Failing test** — flip the `F-intbranch` row of `FAULT_EXPECT` (~3256) and its dedicated assertions (~3428-3433) so the fault expects: no `target-missing` exclusion for any named-target candidate (9006, 9009, 9017 are not excluded — no `adds: ['target-missing:9017']`, no `absent at origin/` AUTO lines, zero target-missing Close proposals), and the spec's plan-review Decision (Reading A: one Warning per skipped pass; `dispatch-unlanded-blockers.js` unchanged) fixes the rest — pin the row as `stderr: [<target-missing skip Warning>, `${LANDING_SKIPPED}no integration branch resolved; no unlanded-blocker exclusions this pull`]` in that order (`assertFaultRow` compares positionally), keep `drops` with `unlanded-blocker:9011` and move the base's `target-missing:9006`/`target-missing:9009` into it, `stdout: []`, and no `adds`. Also update the portability test at ~1727 (`a failing git remote show origin leaves the branch empty ... every named target reads as missing`) to the new behavior: `state.integrationRef` stays `''` when the branch is empty (no `origin/` ref is composed), and `dispatch-named-targets.json` is still written as before — assert both. Update the F-intbranch description in the header comment (~41-42) too. Run `node --test tests/bin-lib/dispatch/queue-pull.test.js` before Step 2: the flipped rows must go red on the current code.
- [ ] **Step 2: Implement** — in both the module and the fence: when the integration branch resolves empty, print one `Warning:` line naming the skipped target-missing pass, record no target-missing exclusions, leave `integrationRef` as `''`, still write `dispatch-named-targets.json` as before, and never run `git cat-file -e origin/:…`; "unresolvable" means an empty branch only (the spec's Plan Review Clarifications — a set-but-unfetched branch is out of scope); leave every pass that does not depend on the branch unchanged, and keep the unlanded-blocker pass's existing empty-branch skip. Keep script and module behavior byte-identical so the parity suite stays green. Do not change the policy-key path or the successful `git remote show origin` path.
- [ ] **Step 3: Run** `node --test tests/bin-lib/dispatch/queue-pull.test.js` — PASS; `wc -c plugin/skills/dispatch/queue-pull-script.md` ≤ 52500.
- [ ] **Step 4: Commit** — one commit, `Skip queue-pull's target-missing pass with a Warning when no integration branch resolves`, body `refs #5305`.

---

## Self-review

- **Spec coverage:** Deliverable (an unresolvable integration branch is a Warning that skips the branch-dependent passes, never a comparison against `origin/`) → Step 2; AC 1 (named-target candidates not excluded; #9011 keeps its exclusion or a Warning names the skipped pass) → Step 1's flipped F-intbranch row.
- **Placeholders:** none.
