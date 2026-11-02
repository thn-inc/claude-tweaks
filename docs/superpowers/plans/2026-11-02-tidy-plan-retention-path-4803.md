# tidy/SKILL.md: run plan-retention.js through CLAUDE_PLUGIN_ROOT in the prune re-verify step (#4803) Implementation Plan

**Goal:** `plugin/skills/tidy/SKILL.md`'s Prune plan Execution column re-runs `plan-retention.js` through `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-retention.js"` instead of a bare `bin/plan-retention.js`, which does not exist at a consumer project's root.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T080858-record-4803/work/4803-spec.md` (materialized from GitHub issue #4803)

---

### Task 1: Replace the bare plan-retention.js path with the CLAUDE_PLUGIN_ROOT form

**Files:**
- Modify: `plugin/skills/tidy/SKILL.md`
- Test: `tests/tidy-plan-retention-conformance.test.js`

- [ ] **Step 1: Failing test** — in `tests/tidy-plan-retention-conformance.test.js`, extend the existing `SKILL.md Action Vocabulary defines Prune plan execution and re-verify (#4465)` test (it already reads the `| **Prune plan**` row via `findRow(TIDY_SKILL, ...)`) with two assertions, tagged `#4803` in a new test of its own sized like its neighbors: the row matches `` re-run `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-retention.js"` on the listed plans `` and does not match a bare `` `bin/plan-retention.js` `` not preceded by `${CLAUDE_PLUGIN_ROOT}/`. Run `node --test tests/tidy-plan-retention-conformance.test.js` — Expected: FAIL (the row still carries the bare path).
- [ ] **Step 2: Implement** — in `plugin/skills/tidy/SKILL.md` line 130 (the `| **Prune plan**` Action Vocabulary row), replace `` re-run `bin/plan-retention.js` on the listed plans `` with `` re-run `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-retention.js"` on the listed plans ``. Touch nothing else in the row.
- [ ] **Step 3: Run** `node --test tests/tidy-plan-retention-conformance.test.js` — PASS; and `grep -n "bin/plan-retention.js" plugin/skills/tidy/SKILL.md` shows only the `${CLAUDE_PLUGIN_ROOT}` form.
- [ ] **Step 4: Commit** — one commit, `Run plan-retention.js through CLAUDE_PLUGIN_ROOT in tidy's prune re-verify — refs #4803`.

---

## Self-review

- **Spec coverage:** the single Deliverable (replace the bare path) is Task 1 Step 2; the grep AC is Task 1 Step 3; the `npm test` AC is covered by Common Step 5's full verification.
- **Placeholders:** none.
