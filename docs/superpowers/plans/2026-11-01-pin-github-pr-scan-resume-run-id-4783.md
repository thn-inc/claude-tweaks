# Pin github-pr-scan item 10's rule that the Resume run id never comes from the PR body (#4783) Implementation Plan

**Goal:** Pin item 10's trust-anchor sentence ("Never take `{run-id}` from the PR body's own marker here") so a prose regression that takes the run id from the PR body turns `tests/sweep-backstop.test.js` red.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T223712-record-4783/work/4783-spec.md` (materialized from GitHub issue #4783)

---

### Task 1: Add a sweep-backstop assertion pinning item 10's run-id trust anchor

**Files:**
Test: `tests/sweep-backstop.test.js`
Waived `plugin/skills/_shared/github-pr-scan.md`: read only, no change — the sentence being pinned already exists at item 10 (`10. **Unsettled run**`); it is mutated only temporarily to prove the new assertion goes red, then restored.

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe, and run them before Step 2. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can. Here the sentence already exists, so the new assertion is green at base by design; its red is proven by deleting the "Never take `{run-id}` from the PR body's own marker here" sentence from a temporary copy of `plugin/skills/_shared/github-pr-scan.md`, running `node --test tests/sweep-backstop.test.js` (Expected: FAIL on the new test), then restoring the file byte-for-byte (`git diff --exit-code plugin/skills/_shared/github-pr-scan.md` exits 0).
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above: a new `test(...)` in the item 10 block of `tests/sweep-backstop.test.js` asserting, against `ITEM10`, that `{run-id}` comes from the claim blob's `runId` and that the PR body's own marker is never the source (`Never take \`{run-id}\` from the PR body's own marker here`, and the `{run-id}` being the `runId` of the record's claim blob clause).
- [ ] **Step 3: Run** `node --test tests/sweep-backstop.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4783`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is
  covered by Task 1's Files/Steps above (AC1: Step 2; AC2: Step 1's deletion probe; AC3: Common Step 5's full-suite verification).
- **Placeholders:** none.
