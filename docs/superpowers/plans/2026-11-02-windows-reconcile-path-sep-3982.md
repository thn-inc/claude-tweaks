# Windows regression: reconcile archival test path separator (#3982) Implementation Plan

**Goal:** Make the `archiveRunDir: the git mv of work/ is committed…` test's `ls-files` assertion compare against git's `/`-separated path on every platform.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T132642-record-3982/spec-3982/work/3982-spec.md` (materialized from GitHub issue #3982)

---

### Task 1: Build the ls-files expected path in git's separator form

**Files:**
Modify: `tests/reconcile.test.js`
Waived `plugin/bin/lib/shared-primitives.js`: `toPosix` reused (read-only)

- [ ] **Step 1: Failing test** — the assertion is the test. It is green at base on macOS/Linux, where `path.sep` is `/`, so no POSIX run can go red. Prove the mismatch in a scratch check instead: `toPosix(path.win32.join(rel, '999-spec.md'), '\\')` equals git's `/` form, and the unconverted `path.win32.join` value does not. Report that output; do not commit the scratch check.
- [ ] **Step 2: Implement** — import `toPosix` from `../plugin/bin/lib/shared-primitives` and wrap the expected value of the `git ls-files` assertion: `toPosix(path.join(archivedWorkRel, '999-spec.md'))`. Leave the `git status --porcelain` assertion above it unchanged.
- [ ] **Step 3: Run** `node --test tests/reconcile.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `refs #3982`.

---

## Self-review

- **Spec coverage:** Deliverable 1 and AC 1 are Step 2; AC 2 is Step 1's scratch check; AC 3 is Step 3; AC 4 is the post-merge `windows-regression.yml` run, which only runs after merge.
- **Placeholders:** none.
