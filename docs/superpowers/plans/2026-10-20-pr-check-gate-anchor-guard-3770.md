# pr-check-gate-conformance's Step 2.5 ordering assert passes vacuously if its anchor is reworded (#3770) Implementation Plan

**Goal:** Make `tests/pr-check-gate-conformance.test.js`'s Step 2.5 ordering asserts fail loudly, naming the anchor, when either anchor (`**Read state first` or ``entry with `conclusion` in``) is missing from `pr-first-merge.md`, instead of comparing against `indexOf`'s `-1`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T212536-record-3770/work/3770-spec.md` (materialized from GitHub issue #3770)

---

### Task 1: Guard anchor presence before the Step 2.5 ordering comparisons

**Files:**
- Test: `tests/pr-check-gate-conformance.test.js`

- [ ] **Step 1: Failing test** — add go-red control tests that remove each anchor (`**Read state first`, and the sibling ``entry with `conclusion` in``) from a copy of `MERGE` and assert `assertStatusContextNormalization` throws with a message naming that anchor. Against the current code the `**Read state first` control fails (the ordering assert passes vacuously, so nothing throws).
- [ ] **Step 2: Implement** — in `assertStatusContextNormalization`, resolve each anchor's index first and `assert.notEqual(idx, -1, '... anchor `{anchor}` not found ...')` before the `>`/`<` ordering comparison.
- [ ] **Step 3: Run** `node --test tests/pr-check-gate-conformance.test.js` — PASS (existing tests unchanged against the current `pr-first-merge.md`, new controls green).
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3770`.

---

## Self-review

- **Spec coverage:** Deliverable (presence guard on both anchors) → Step 2; AC1 (removing `**Read state first` from a fixture copy fails naming the anchor) → Step 1's control test; AC2 (passes unchanged against current doc) → Step 3.
- **Placeholders:** none.
