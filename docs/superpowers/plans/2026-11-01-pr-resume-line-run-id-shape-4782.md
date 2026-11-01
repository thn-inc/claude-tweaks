# Reject a malformed --run-id in pr-resume-line.js before it reaches resumeVerdict (#4782) Implementation Plan

**Goal:** `plugin/bin/pr-resume-line.js` accepts an untrusted `--run-id` and checks only that it is non-empty before passing it to `resumeVerdict`; reject one that does not match `RUN_ID_SHAPE`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T195953-record-4782/work/4782-spec.md` (materialized from GitHub issue #4782)

---

### Task 1: Reject a --run-id that fails RUN_ID_SHAPE before resumeVerdict is called

**Files:**
- Modify: `plugin/bin/pr-resume-line.js`
- Test: `tests/pr-resume-line-cli.test.js`

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe, and run them before Step 2. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4782`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is
  covered by Task 1's Files/Steps above.
- **Placeholders:** none.
