# verify.js CI source: one transient gh timeout drops every CI-sourced suite to a full local run (#5437) Implementation Plan

**Goal:** Retry a timed-out `gh` read in `fetchCiVerdict` before a CI-sourced suite falls back to a full local run.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T072609-record-5437/work/5437-spec.md` (materialized from GitHub issue #5437)

---

### Task 1: Retry timed-out gh reads in the CI source and name the attempt count in the fallback reason

**Files:**
- Modify: `plugin/bin/lib/verify/ci-source.js`
- Modify: `plugin/skills/test/ci-source.md`
- Test: `tests/bin-lib/verify/ci-source.test.js`

- [x] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe, and run them before Step 2. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can.
- [x] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above.
- [x] **Step 3: Run** the test(s) from Step 1 — PASS.
- [x] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #5437`.

Completed by the express-lane worker before escalation (out-of-bounds: 55 implementation lines > 40) in commit `f085bed5e2`; the escalation kept the worktree and branch, so this build resumes after Task 1.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is covered by Task 1's Files/Steps above.
- **Placeholders:** none.
