# pr-checklist.js: pin four untested phase-checklist transform cases (#3707) Implementation Plan

**Goal:** Pin the four documented-but-untested `setPhaseRow` transform behaviors in `plugin/bin/lib/flow/pr-checklist.js` with one test each, so dropping any of those branches turns a test red.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T170123-record-3707/work/3707-spec.md` (materialized from GitHub issue #3707)

---

### Task 1: Add four transform-case tests to the pr-checklist suite

**Files:**
- Test: `tests/bin-lib/flow/pr-checklist.test.js`
- Modify: `plugin/bin/lib/flow/pr-checklist.js` (read-only unless a new test exposes a defect)

- [ ] **Step 1: Failing test** — add one test each to `tests/bin-lib/flow/pr-checklist.test.js`: (a) duplicate rows for the same phase in the span, one `- [x]` and one `- [ ]` — flip checks the unchecked one, `--remove` deletes only the unchecked one; (b) an uppercase `- [X] {phase}` row is already checked — flip and `--remove` both return `already-checked` with the body unchanged; (c) an HTML start marker with no matching HTML end marker falls back to the plain-text companion span; (d) a phase row before the start marker is left untouched while the in-span row flips. For each, prove discrimination by temporarily deleting or inverting the branch it covers in `pr-checklist.js` and observing red (case (b): remove `` `- [X] ${phase}` `` from the checked set at line 45), then restore the file byte-for-byte.
- [ ] **Step 2: Implement** — no implementation change expected; `pr-checklist.js` already handles all four cases. Change it only if a new test exposes a defect.
- [ ] **Step 3: Run** `node --test tests/bin-lib/flow/pr-checklist.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3707`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (a)-(d) map to Step 1's four tests; Deliverable 2 (red-on-revert per test) is Step 1's discrimination proof; AC 1 is Step 3; AC 2 is case (b)'s revert probe.
- **Placeholders:** none.
