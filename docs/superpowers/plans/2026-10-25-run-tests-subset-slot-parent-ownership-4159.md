# run-tests --files-from subset lane skips the ownership check on its fixed-name slot parent directory (#4159) Implementation Plan

**Goal:** Make the `--files-from` subset lane ownership-check the fixed-name slot parent (`<tmpdir>/ct-test-suite-slots`, or `CT_TEST_SUITE_SLOT_DIR`) as well as its `subset/` leaf, the same hardening the full-suite lane already gets.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T093152-record-4159/work/4159-spec.md` (materialized from GitHub issue #4159)

---

### Task 1: Ownership-check the slot base directory before the subset leaf

**Files:**
- Modify: `tools/run-tests.js`
- Test: `tests/run-tests-isolation.test.js`

- [ ] **Step 1: Failing test** — add a process-level test to `tests/run-tests-isolation.test.js`, next to `a --files-from subset does not wait behind a held full-suite slot` and built the same way (a runner copy under a throwaway repo root inside `withSandbox`). Point `CT_TEST_SUITE_SLOT_DIR` at a symlink to a real directory elsewhere — a pre-created parent that fails `ensureOwnDir`'s check (not a directory owned by this user) without needing a second OS user. Run `--files-from`. Assert: non-zero exit, stderr matches `/not a directory owned by this user/`, no test run started, and no `subset/` directory was created inside the symlink's target. Skip on win32 (creating a symlink needs extra privileges), as the existing `ensureOwnDir` test does. Run it against the current code: it must FAIL, because today the subset lane only checks `<link>/subset`, which `mkdirSync` creates through the symlink as a real directory owned by this user.
- [ ] **Step 2: Implement** — in `tools/run-tests.js`'s main block, call `ensureOwnDir` on the slot base directory before `acquireSlot` ensures the lane leaf, so the subset lane checks both the parent and `subset/`. `slotLane` stays pure.
- [ ] **Step 3: Run** `node --test tests/run-tests-isolation.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `Ownership-check the subset lane's slot parent in run-tests — refs #4159`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (`ensureOwnDir(baseDir)` before the subset leaf) → Step 2. Deliverable 2 (pre-created-parent test in `tests/run-tests-isolation.test.js`) → Step 1. AC "ownership-checks both the parent and the leaf" → Step 2 (the leaf check stays in `acquireSlot`). AC "the new test goes red against the current code" → Step 1's run before Step 2. AC "`npm test` passes" → Common Step 5's final verification.
- **Placeholders:** none.
