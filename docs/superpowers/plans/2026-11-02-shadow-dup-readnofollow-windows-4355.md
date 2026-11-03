# Windows: shadow-dup-proposal reads a staged symlink through to its target (#4355) Implementation Plan

**Goal:** `readNoFollow` in `plugin/bin/shadow-dup-proposal.js` refuses a symlinked leaf on a platform without `O_NOFOLLOW`, so a staged symlink never pulls an outside file into a filed record.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T082823-record-4355/work/4355-spec.md` (materialized from GitHub issue #4355)

---

### Task 1: Add the no-O_NOFOLLOW fallback to readNoFollow with injectable constants

**Files:**
Modify: `plugin/bin/shadow-dup-proposal.js`
Test: `tests/bin-lib/console/shadow-dup-proposal.test.js`
Waived `plugin/bin/lib/path-guard/index.js`: reuse lstatType (no change expected)

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe, and run them before Step 2. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4355`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is covered by Task 1's Files/Steps above.
- **Placeholders:** none.
