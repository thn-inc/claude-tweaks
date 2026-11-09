# checkResumeFreshness reads an unreadable worktree path as worktree-gone, so an interrupted run resumes (#4435) Implementation Plan

**Goal:** `checkResumeFreshness` returns `worktree-gone` only for a recorded worktree path that is truly missing (path-guard's `lstatType(...).type === 'missing'`), so an unreadable path of an `interrupted` run falls through to the liveness probe and fails closed to `indeterminate`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T203115-record-4435/work/4435-spec.md` (materialized from GitHub issue #4435)

---

### Task 1: Gate `worktree-gone` on path-guard's `lstatType` instead of `fs.existsSync`

**Files:**
- Modify: `plugin/bin/lib/hooks/resume-freshness.js`
- Modify: `tests/path-guard-conformance.test.js`
- Test: `tests/hooks-resume-freshness.test.js`

- [ ] **Step 1: Failing test** — in `tests/hooks-resume-freshness.test.js`, add a row where an `interrupted` run's recorded worktree path is a symlink loop (`ELOOP`: a symlink pointing at itself), asserting verdict `indeterminate` and `safe: false` (red on current code, which returns `worktree-gone`). The existing missing-path row (`/no/such/path/at/all` → `worktree-gone`) already covers AC2; keep it.
- [ ] **Step 2: Implement** — in `resume-freshness.js`, replace `if (!fs.existsSync(worktree)) return { safe: true, verdict: 'worktree-gone' };` with a check on `lstatType(worktree).type === 'missing'` (`require('../path-guard')`), dropping the now-unused `fs` require if nothing else uses it. Keep the verdict-string set and the order of the five pre-probe returns unchanged. In `tests/path-guard-conformance.test.js`, remove the `'lib/hooks/resume-freshness.js'` ALLOWLIST entry (`existsSync: 1`).
- [ ] **Step 3: Run** `node --test tests/hooks-resume-freshness.test.js tests/path-guard-conformance.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4435`.

---

## Self-review

- **Spec coverage:** Deliverable 1 / AC1 → Steps 1-2 (ELOOP row, `lstatType` gate); Deliverable 2 → Step 2 (verdict set and return order unchanged; the existing AC5 verdict-set test stays green); Deliverable 3 (PR-body equivalence row) → handled at the PR body by the orchestrator, not code; AC2 → existing missing-path row; AC3 → Step 2 allowlist removal + Step 3; AC4 → `/build` Common Step 5 verification.
- **Placeholders:** none.
