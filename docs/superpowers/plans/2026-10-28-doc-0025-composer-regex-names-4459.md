# Doc staleness: ADR 0025 Consequences cites a nonexistent COMPOSER_CALL regex (#4459) Implementation Plan

**Goal:** Make ADR 0025's Consequences section name the two regexes `tests/merge-subject-composer-conformance.test.js` actually declares (`LOCAL_COMPOSER_CALL`, `PR_FIRST_COMPOSER_CALL`), replacing its citation of a nonexistent bare `COMPOSER_CALL`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T172429-record-4459/work/4459-spec.md` (materialized from GitHub issue #4459)

---

### Task 1: Name both composer-call regexes in ADR 0025's Consequences

**Files:**
- Modify: `docs/decisions/0025-merge-subject-scope-is-repo-policy-resolved-in-the-composer.md`

- [ ] **Step 1: Failing test** — none committed: this is a docs-only prose correction with no behavioral surface, and the repo keeps no conformance test pinning ADR prose. The scratch check is `grep -n "COMPOSER_CALL" docs/decisions/0025-merge-subject-scope-is-repo-policy-resolved-in-the-composer.md`, which today shows the bare `` `COMPOSER_CALL` regex `` at line 93.
- [ ] **Step 2: Implement** — replace the Consequences bullet's lines

  ```
  - Every fence must name a diff source. `tests/merge-subject-composer-conformance.test.js`'s
    `COMPOSER_CALL` regex pins this at all six call lines, so a fence added later without one fails
    the suite.
  ```

  with

  ```
  - Every fence must name a diff source. `tests/merge-subject-composer-conformance.test.js`'s
    `LOCAL_COMPOSER_CALL` and `PR_FIRST_COMPOSER_CALL` regexes pin this at all six call lines, so a
    fence added later without one fails the suite.
  ```
- [ ] **Step 3: Run** — `grep -n "COMPOSER_CALL" docs/decisions/0025-merge-subject-scope-is-repo-policy-resolved-in-the-composer.md` shows only `LOCAL_COMPOSER_CALL` and `PR_FIRST_COMPOSER_CALL`, and both identifiers appear as `const` declarations in `tests/merge-subject-composer-conformance.test.js`.
- [ ] **Step 4: Commit** — one commit, `Fix ADR 0025 composer-call regex citation — name LOCAL_COMPOSER_CALL and PR_FIRST_COMPOSER_CALL (refs #4459)`.

---

## Self-review

- **Spec coverage:** the single `## Deliverables` Current→Proposed edit and the single `## Acceptance Criteria` item (identifier matches the test file's declared names) are both covered by Task 1.
- **Placeholders:** none.
