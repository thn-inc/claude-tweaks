# ceremony-derive isDocsPath: treat docs/plans/*.html diagram artifacts as docs so fast-lane can derive (#4187) Implementation Plan

**Goal:** `isDocsPath` (`plugin/bin/lib/dispatch/ceremony-derive.js`) counts a `docs/plans/*.html` diagram as docs, so a docs-only record that ships a `/claude-tweaks:visualize` diagram can derive `fast-lane`.

**Spec:** `.claude-tweaks/pipelines/archive/2026-10-25T080723-record-4187/work/4187-spec.md` (materialized from GitHub issue #4187)

---

### Task 1: Treat docs/plans/*.html as docs in isDocsPath

**Files:**
- Modify: `plugin/bin/lib/dispatch/ceremony-derive.js`
- Test: `tests/bin-lib/dispatch/ceremony-derive.test.js`
- Modify: `plugin/skills/wrap-up/ceremony-derivation.md` (prose twin, step 2's docs sentence; scope-creep add-to-plan)
- Modify: `plugin/skills/build/micro-plan.md` (prose twin, gate 3's docs exclusion; scope-creep add-to-plan)

- [ ] **Step 1: Failing test.** In `tests/bin-lib/dispatch/ceremony-derive.test.js`, add:
  - `computeDiffFacts` on `[docs/plugin-structure.md, docs/reference/x.md, docs/plans/x.html]` gives `lowSurface: true`, `docsOnly: true`, `implFiles: 0`, and `deriveCeremonyProfile(..., 'standard') === 'fast-lane'`.
  - `isDocsPath` is true for `docs/plans/x.html` and `docs/plans/2026-10-25-spec-1-flow.HTML`, and false for `.html` files outside `docs/plans/`: `index.html`, `docs/x.html`, `docs/diagrams/x.html`, `docs/plans/sub/x.html`, `plugin/skills/visualize/template.html`, `src/docs/plans/x.html`.
  Run: `node --test tests/bin-lib/dispatch/ceremony-derive.test.js`
  Expected: FAIL (the positive cases fail on current code).
- [ ] **Step 2: Implement.** `isDocsPath(path)` returns true for markdown that is not prompt prose (unchanged), OR for a path matching `^docs/plans/[^/]+\.html$` (case-insensitive extension). Update the comment above it. In the two prose twins, name `docs/plans/*.html` (the `/claude-tweaks:visualize` diagram path) next to the existing docs examples.
- [ ] **Step 3: Run** `node --test tests/bin-lib/dispatch/ceremony-derive.test.js tests/build-micro-plan-conformance.test.js tests/ceremony-derivation-mode-gate.test.js`. Expected: PASS.
- [ ] **Step 4: Commit.** One commit: `Treat docs/plans/*.html diagrams as docs in isDocsPath — refs #4187`.

---

## Self-review

- **Spec coverage:** Deliverable 1 is Step 2. Deliverable 2 is Step 1. AC1 (`.md` docs plus `docs/plans/x.html` gives lowSurface) is Step 1's first bullet. AC2 (`.html` outside `docs/plans/` is still implementation) is Step 1's negative cases. AC3 (the new test fails before the change) is Step 1's Expected: FAIL, proven by running it before Step 2.
- **Placeholders:** none.
