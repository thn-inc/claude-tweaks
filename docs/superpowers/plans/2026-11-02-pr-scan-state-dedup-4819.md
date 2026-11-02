# pr-scan item 4 wrongly calls PR states exclusive (#4819) Implementation Plan

**Goal:** `plugin/skills/_shared/github-pr-scan.md` item 4 treats `--state merged` and `--state closed` as mutually exclusive, but `gh pr list --state closed` also returns merged PRs — correct the sentence and de-duplicate the two results by PR number.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T015839-record-4819/work/4819-spec.md` (materialized from GitHub issue #4819)

---

### Task 1: De-duplicate item 4's merged/closed results by PR number and correct the exclusivity sentence

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan.md`
- Test: `tests/github-pr-scan-closed-merged-overlap.test.js`

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe, and run them before Step 2. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4819`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is
  covered by Task 1's Files/Steps above.
- **Placeholders:** none.
