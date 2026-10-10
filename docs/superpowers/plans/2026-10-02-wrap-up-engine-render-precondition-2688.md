# bin/wrap-up-engine.js: render fails silently when the plan/record sequence was skipped (#2688) Implementation Plan

**Goal:** Make `wrap-up-engine.js render --section console` fail loud with an actionable message when the run's `record` step was never invoked after `plan`, instead of silently producing empty output.

**Spec:** `.claude-tweaks/pipelines/2026-10-02T061950-record-2688/work/2688-spec.md` (materialized from GitHub issue #2688)

---

### Task 1: Add a missing-engine-state precondition check to `render --section console`

**Files:**
- Modify: `plugin/bin/wrap-up-engine.js`
- Test: `tests/bin/wrap-up-engine.test.js` (create if it does not yet exist; otherwise extend the existing suite)

- [ ] **Step 1: Failing test** — write test(s) covering: (a) `render --section console --strict` against a run-dir with a `plan` output but no `record` call exits non-zero with a non-empty, actionable error message naming the missing precondition; (b) the same command without `--strict` also produces the actionable message (not silent exit 0 with empty output); (c) `render --section console` against a run-dir that DID complete `record` is unaffected.
- [ ] **Step 2: Implement** — in `render`'s `--section console` handler, before rendering, check whether the expected engine-state artifact (written by the `record` step) is absent or empty; if so, exit non-zero on both `--strict` and non-strict paths with a clear, actionable message naming the missing precondition and the remedy (e.g. "no engine-state.json found for this run-dir — run `record` first."). Do not add a fallback that synthesizes a Review Console from a `plan`-only run-dir.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #2688`.

---

## Self-review

- **Spec coverage:** all three `## Acceptance Criteria` items (strict-mode actionable error, non-strict actionable error, unaffected happy path) are covered by Task 1's Files/Steps above. Both `## Deliverables` items (actionable failure under both `--strict` and non-strict) are covered by Step 2.
- **Placeholders:** none.
