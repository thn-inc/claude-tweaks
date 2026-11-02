# pr-early-open logs "reopened PR" after a gh exit 0 without confirming the PR is OPEN (#4833) Implementation Plan

**Goal:** `openPrEarly` confirms a non-throwing `gh pr reopen` with a re-list before it logs, rebinds, records or pushes as `reopened`; an unconfirmed reopen takes the rejected-reopen path to the create path.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T061725-record-4833/work/4833-spec.md` (materialized from GitHub issue #4833)

---

### Task 1: Confirm OPEN after a non-throwing reopen and route an unconfirmed reopen to creation

**Files:**
Modify: `plugin/bin/lib/flow/pr-early-open.js`
Test: `tests/bin-lib/flow/pr-early-open.test.js`

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe, and run them before Step 2. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4833`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is covered by Task 1's Files/Steps above.
- **Placeholders:** none.
