# Structurally-stuck escalation record never names #3503's merged-partial reason (#3705) Implementation Plan

**Goal:** Make `structurallyStuckBody`'s fixed text name every `STRUCTURALLY_STUCK_REASONS` member that can reach the record (adding `merged-partial` and its remedy), mirror that in `docs/reconcile-checks.md`, and pin the two against each other with a test.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T180932-record-3705/work/3705-spec.md` (materialized from GitHub issue #3705)

---

### Task 1: Name `merged-partial` in the structurally-stuck body, document the `no-repo-slug` exclusion, and pin body against the reason set

**Files:**
- Modify: `plugin/bin/lib/reconcile/escalate-residue.js`
- Modify: `docs/reconcile-checks.md`
- Test: `tests/bin-lib/reconcile/escalate-residue.test.js`

- [ ] **Step 1: Failing test** — in `tests/bin-lib/reconcile/escalate-residue.test.js`, import `STRUCTURALLY_STUCK_REASONS` from `plugin/bin/lib/reconcile/archive-merged.js` and add an explicit, commented constant excluding `no-repo-slug` (with no repo slug, `findOrCreateIssue` returns `escalation-failed`, so that reason can never be filed into the record). Assert every other member appears backticked in `structurallyStuckBody([])`. Also assert the body carries a `merged-partial` remedy sentence. Run it and expect FAIL on `merged-partial`.
- [ ] **Step 2: Implement** — add `` `merged-partial` `` to the body's reason list in `structurallyStuckBody`. Add a remedy line saying the run's merged PR left the listed records open, so ship them in a later PR or close/release them if they were abandoned, and the next reconcile archives the dir and drops it from this record. Update `docs/reconcile-checks.md`'s consolidated-escalation passage (~line 248) to name `merged-partial` with its remedy, and to say `no-repo-slug` is tracked but can never be filed into the record.
- [ ] **Step 3: Run** `node --test tests/bin-lib/reconcile/escalate-residue.test.js` and expect PASS. Then prove discrimination by reverting: (a) remove `merged-partial` from the body, and the new test fails; (b) temporarily add a fake reason to `STRUCTURALLY_STUCK_REASONS`, and the new test fails; (c) remove some other reason (e.g. `no-branch`) from the body, and the new test fails. Restore each one afterwards.
- [ ] **Step 4: Commit** — one commit, `Name merged-partial in the structurally-stuck escalation body — pin body against STRUCTURALLY_STUCK_REASONS`, `refs #3705`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (body names `merged-partial` and its remedy) is Step 2. Deliverable 2 (docs passage plus the `no-repo-slug` explanation) is Step 2. Deliverable 3 (test with an explicit commented exclusion) is Step 1. AC "fails on removal / on new reason, demonstrate by reverting" is Step 3. AC `npm test` passes is covered by build's Common Step 5.
- **Placeholders:** none.
