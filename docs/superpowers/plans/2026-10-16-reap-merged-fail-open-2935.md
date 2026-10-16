# reconcile: gitCommittedToRemoval treats an unresolvable registered entry as absent (fail-open branch) (#2935) Implementation Plan

**Goal:** Make `gitCommittedToRemoval` fail closed when a registered worktree entry's path cannot be resolved for a non-ENOENT reason, instead of silently treating it as absent.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T102133-record-2935/work/2935-spec.md` (materialized from GitHub issue #2935)

---

### Task 1: Fail closed on unresolvable registered worktree entries in `gitCommittedToRemoval`

**Files:**
- Modify: `plugin/bin/lib/reconcile/reap-merged.js`
- Test: `tests/bin-lib/reconcile/reap-merged.test.js`

- [ ] **Step 1: Failing test** — add a unit test that injects a `realpath` throwing a non-ENOENT error (e.g. `EACCES`) for the target's registered worktree entry and asserts `gitCommittedToRemoval` returns `false`; add a second test injecting an ENOENT failure for a *non-target* entry and asserts the target's result is unchanged from today's behavior.
- [ ] **Step 2: Implement** — in `gitCommittedToRemoval`, replace the `safeReal(wt.path) || wt.path` fallback with an explicit try/catch around an injectable `realpath` (default `fs.realpathSync`, optional third `{ realpath }` argument, existing two-argument callers unaffected). On ENOENT, the entry is non-matching (today's mid-deletion behavior). On any other error, short-circuit the whole function to `false`. Update the header comment above the function to state the per-entry fail-closed rule alongside the existing "an unreadable list fails closed" sentence. Do not modify `safeReal` in `plugin/bin/lib/hooks/worktree-detect.js`.
- [ ] **Step 3: Run** `node --test tests/bin-lib/reconcile/reap-merged.test.js` — PASS, including the new tests and the existing #2566 tests (mid-deletion finish, dirty/locked refusal) unchanged.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #2935`.

---

## Self-review

- **Spec coverage:** Deliverables 1-4 and both Acceptance Criteria bullets are covered by Task 1's Files/Steps above.
- **Placeholders:** none.
