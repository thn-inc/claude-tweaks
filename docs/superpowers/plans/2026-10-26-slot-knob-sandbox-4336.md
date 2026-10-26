# run-tests-isolation slot-wait test fails when the suite runs with CT_TEST_SUITE_SLOTS raised (#4336) Implementation Plan

**Goal:** `tests/run-tests-isolation.test.js`'s `withSandbox` stops leaking the parent's slot-count knobs (`CT_TEST_SUITE_SLOTS`, `CT_TEST_SUBSET_SLOTS`) into the sandboxed `tools/run-tests.js` child, so every process-level test runs with the default slot count of 1.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T123848-spec-4336-4419-4420-4421/spec-4336/work/4336-spec.md` (materialized from GitHub issue #4336)

---

### Task 1: Clear the slot-count knobs from the sandbox env

**Files:**
- Test: `tests/run-tests-isolation.test.js` (Modify — `withSandbox`, line 393, and its header comment, line 390)

- [ ] **Step 1: Failing test** — the failing test already exists: `run-tests.js waits for a slot held by a live pid, naming the holder` (line 600). Confirm red before the change:
  Run: `CT_TEST_SUITE_SLOTS=2 node --test --test-name-pattern="waits for a slot held by a live pid" tests/run-tests-isolation.test.js`
  Expected: FAIL — `timed out after 60000ms waiting for the slot-wait message`.
- [ ] **Step 2: Implement** — in `withSandbox`, add `delete sb.env.CT_TEST_SUITE_SLOTS;` and `delete sb.env.CT_TEST_SUBSET_SLOTS;` beside `delete sb.env.CT_TEST_SUITE_SLOT_HELD;`. Delete, never set to `'1'` (an explicit value would mask a future change to `resolveSlots`'s default). Keep `CT_TEST_SUITE_SLOT_DIR` untouched. Update the comment above `withSandbox` to name the two slot-count knobs among the cleared variables and say why: the slot tests assume exactly one slot.
- [ ] **Step 3: Run** —
  - `CT_TEST_SUITE_SLOTS=2 node --test tests/run-tests-isolation.test.js` → PASS (AC 1)
  - `CT_TEST_SUBSET_SLOTS=2 node --test tests/run-tests-isolation.test.js` → PASS (AC 2)
  - `node --test tests/run-tests-isolation.test.js` with neither knob → PASS (AC 4)
  - Revert-proof (AC 3): with only the two new `delete` lines removed, the AC 1 command fails again on the slot-wait test (`timed out … waiting for the slot-wait message`); restore them in the same command.
- [ ] **Step 4: Commit** — one commit, `Clear the slot-count knobs from run-tests-isolation's sandbox env — refs #4336`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (delete both knobs) → Step 2; Deliverable 2 (comment names the knobs and why) → Step 2. AC 1, 2 and 4 → Step 3's runs; AC 3 → Step 3's revert-proof; AC 5 (`npm test`) → Common Step 5's verification.
- **Placeholders:** none.
