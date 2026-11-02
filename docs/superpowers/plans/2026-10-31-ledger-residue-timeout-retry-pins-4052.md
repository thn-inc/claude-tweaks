# ledger-residue.js timeout-retry policy is unpinned (#4052) Implementation Plan

**Goal:** Pin `plugin/bin/lib/reconcile/ledger-residue.js`'s timeout-retry policy — the two list helpers retry once on a timeout, the PR create never retries — with tests that fail when the policy is reverted.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T101111-spec-4107-4052-4070-4090-4101-4105-4106-4073/spec-4052/work/4052-spec.md` (materialized from GitHub issue #4052)

---

### Task 1: Add three timeout-policy tests to ledger-residue.test.js

**Review risk:** high

**Files:**
- Modify: `tests/bin-lib/reconcile/ledger-residue.test.js`
- Waived `plugin/bin/lib/reconcile/ledger-residue.js`: read-only — the three helpers under test (temporarily edited only for the revert proofs, never committed)
- Waived `plugin/bin/lib/shared-primitives.js`: read-only reference — `runClassified` / `isTimeoutError`

- [ ] **Step 1: Failing test** — add three tests, following the file's injected-`exec` style and the timeout-error construction in `tests/bin-lib/reconcile/pr-state.test.js:241` (`const e = new Error('boom'); e.code = 'ETIMEDOUT'; throw e;` — only the `code` branch of `isTimeoutError`). Count calls with a closure counter.
  1. `defaultListOpenRecords`: first `exec` call throws the timeout error, second returns `'[]'` → returns `[]`, `exec` called exactly twice.
  2. `defaultListRemovalPrs`: the first `matching-refs` read throws the timeout error, later calls succeed → returns the PR list, and the count of calls whose args include `matching-refs` is 2 (the retry re-runs the whole closure).
  3. `defaultCreatePr`: `exec` throws the timeout error → returns `'network-failure'`, `exec` called exactly once.
  These pass against current code (they pin existing behavior); their RED is the revert proofs in Step 3.
- [ ] **Step 2: Implement** — tests only; no production change (`git diff plugin/` stays empty).
- [ ] **Step 3: Run** `node --test tests/bin-lib/reconcile/ledger-residue.test.js` — PASS. Revert proofs, each observed and then restored before the next (confirm `git diff --exit-code plugin/` after each): remove `{ retryOnTimeout: true }` from `defaultListOpenRecords` → test 1 fails; remove it from `defaultListRemovalPrs` → test 2 fails; for `defaultCreatePr`, which calls `exec` directly with no `runClassified` (so there is no options argument to add the flag to — putting it in `exec`'s own options changes nothing), temporarily wrap its exec-and-parse body in `sharedPrimitives.runClassified(() => { ... }, classifyExecError, { retryOnTimeout: true })` → test 3 fails because `exec` is now called twice (test 3's `exec` throws the timeout error on every call). Record each command and its failing output in the report.
- [ ] **Step 4: Commit** — one commit, `Pin ledger-residue timeout-retry policy — list helpers retry once, PR create never`, `refs #4052`.

---

## Self-review

- **Spec coverage:** Deliverables 1-3 → Step 1 tests 1-3. AC1 → Steps 1/3; AC2 (AC2.1-2.3 revert proofs) → Step 3; AC3 (no production change) → Step 2 + `git diff --exit-code plugin/`; AC4 (`npm test`) → Common Step 5.
- **Placeholders:** none.
