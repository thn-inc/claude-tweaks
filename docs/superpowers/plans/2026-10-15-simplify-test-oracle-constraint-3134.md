# Simplify criteria: test-oracle constraint (#3134) Implementation Plan

**Goal:** Stop simplification from replacing a test's literal expected value with the production constant or function under test.

**Spec:** `.claude-tweaks/pipelines/2026-10-15T165959-spec-3134/work/3134-spec.md` (materialized from GitHub issue #3134)

---

### Task 1: Add the test-oracle constraint to the fragment and the simplify dispatch line, pinned by tests

**Files:**
- Modify: `plugin/skills/_shared/criteria-simplification.md` (new bullet in `## Constraints (what NOT to flag)`, after the "Preserve all behavior" bullet)
- Modify: `plugin/skills/simplify/SKILL.md` (Step 2 dispatch template's `- Constraints:` line, inside the fenced block)
- Test: `tests/code-health-misc/criteria-fragments.test.js` (extend "simplification fragment carries signature criteria"; add a test for the dispatch line)
- Read only: `plugin/bin/lib/code-health/criteria.js` (confirm the fragment is inlined whole into the code-health lens prompt)

- [ ] **Step 1: Failing test** — in `tests/code-health-misc/criteria-fragments.test.js`:
  - In "simplification fragment carries signature criteria", assert the fragment's Constraints section (text between `## Constraints` and the next `## ` heading) contains a bullet matching `/expected value/i` together with `/oracle/i` and `/test-local constant/i`.
  - Add test "/simplify dispatch Constraints line carries the test-oracle clause": read `simplify/SKILL.md`, take the line starting `- Constraints:` that sits inside the Step 2 fenced block, and assert it matches `/expected value/i` and names the production constant it must not be replaced with (`/production constant/i`).
  - Run: `node --test tests/code-health-misc/criteria-fragments.test.js` — Expected: FAIL (both new assertions).
- [ ] **Step 2: Implement** — add to `criteria-simplification.md`'s Constraints section:
  `- **Don't replace a test's expected value with the code under test** — a literal expected value in a test assertion is an independent oracle, not duplication. Replacing it with the production constant (or a call to the production function) that the test checks still passes, but the assertion can then hold for any value of that constant, so the test can no longer fail. Moving a repeated literal into a test-local constant is fine; reading the expected value from the module under test is not. Production code that duplicates a constant is still fair game.`
  and extend `simplify/SKILL.md`'s dispatch `Constraints:` line with one clause after "never expand scope beyond the listed files": `never replace a literal expected value in a test assertion with the production constant or function it checks (a test-local constant is fine)`.
- [ ] **Step 3: Run** `node --test tests/code-health-misc/criteria-fragments.test.js` — PASS. Revert each addition in turn and confirm its assertion goes red, then restore. Confirm by reading `criteria.js` that the lens prompt inlines the whole fragment file (no section filter).
- [ ] **Step 4: Commit** — one commit, `Add a test-oracle constraint to the simplification criteria — refs #3134`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (fragment bullet) → Step 2 first edit; Deliverable 2 (dispatch clause in the fenced template) → Step 2 second edit; Deliverable 3 (pins) → Step 1. AC "reverting turns red" → Step 3; AC code-health picks it up with no code change → Step 3's `criteria.js` read; AC `npm test` full → Common Step 5.
- **Placeholders:** none.
