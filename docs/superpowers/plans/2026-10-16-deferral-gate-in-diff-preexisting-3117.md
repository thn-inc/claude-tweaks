# build / deferral-gate: pre-existing defect in an in-diff file (#3117) Implementation Plan

**Goal:** Make `/build`'s quoted surgical-changes rule and `_shared/deferral-gate.md` compose explicitly: a reported pre-existing defect in an in-diff file goes through the gate's fix-now test, and "pre-existing" alone is not a defer reason.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T162755-spec-3117/work/3117-spec.md` (materialized from GitHub issue #3117)

---

### Task 1: Add the composition sentence and the gate bullet, pinned by the existing conformance tests

**Files:**
- Modify: `plugin/skills/build/SKILL.md`
- Modify: `plugin/skills/_shared/deferral-gate.md`
- Test: `tests/working-approach-scope-discipline.test.js`
- Test: `tests/deferral-gate-conformance.test.js`

- [ ] **Step 1: Failing test** — in `tests/working-approach-scope-discipline.test.js`'s `/build quotes the same three sentences…` test, assert the Scope and edit discipline paragraph contains the new composition sentence (exact literal) and that it sits after the quoted Working Approach text (index after `EDIT_IN_PLACE_SENTENCE`). In `tests/deferral-gate-conformance.test.js`, add a test asserting the Bad reasons list (the slice between `## Bad reasons to skip a fix` and the next `## ` heading) contains the new bullet literal, and that the bullet follows the "Out of scope of this plan / spec" bullet.
- [ ] **Step 2: Implement** —
  - `plugin/skills/build/SKILL.md`, "Scope and edit discipline" paragraph: append, after the existing final sentence "…both per Common Step 4 below.", one sentence outside the quote: `The quoted rule limits what an implementer changes mid-task, not a reported follow-up's disposition: \`_shared/deferral-gate.md\`'s fix-now test decides that before the follow-up reaches the ledger or \`/claude-tweaks:capture\`.` The three quoted Working Approach sentences stay byte-identical. File is ~45.2 KB against the 45 KB (46,080 B) soft per-file ceiling — keep the addition to this one sentence.
  - `plugin/skills/_shared/deferral-gate.md`, "Bad reasons to skip a fix": insert immediately after the `*"Out of scope of this plan / spec"*` bullet: `- *"Pre-existing"* — a reported pre-existing defect in a file this build's diff touches goes through the fix-now test above like any other finding; pre-existence alone is never a defer reason. Only \`pre-existing-outside-diff\` (a file the diff does not touch) defers on pre-existence`. Also add `skills/build/SKILL.md` to the file's consumer list at the top (it now cites this file).
  - Do NOT change `DEFER_REASONS`, the `pre-existing-outside-diff` definition, or the floor mapping.
- [ ] **Step 3: Run** `node --test tests/working-approach-scope-discipline.test.js tests/deferral-gate-conformance.test.js` — PASS. Then revert each new prose line in turn (scratch only) and confirm its test goes red.
- [ ] **Step 4: Commit** — one commit, `Compose surgical-changes rule with the deferral gate — pre-existing alone is not a defer reason`, `refs #3117`.

---

## Self-review

- **Spec coverage:** Deliverables 1-3 and all five Acceptance Criteria are covered by Task 1's Files/Steps above (AC 3 by the explicit "do not change" constraint plus the existing vocabulary-equality test; AC 5 by Common Step 5's full suite).
- **Placeholders:** none.
