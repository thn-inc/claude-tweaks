# verify.js --stamp-suite passes an undeclared 'stamp-suite' mode literal to newAndFixed, unpinned by the #4040 test (#4072) Implementation Plan

**Goal:** Declare the `--stamp-suite` scope mode as a named constant beside `KNOWN_SCOPES` in `plugin/bin/verify.js`, use it at the `newAndFixed` call, and pin its `report.json` outcome in the #4040 regression test.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T155757-record-4072/work/4072-spec.md` (materialized from GitHub issue #4072)

---

### Task 1: Name the stamp-suite mode and pin its pre-existing report

**Files:**
- Modify: `plugin/bin/verify.js` (constant beside `KNOWN_SCOPES`, ~line 56; used at the `newAndFixed` call, ~line 854)
- Test: `tests/bin-lib/verify/cli.test.js` (the `#4040` test, ~line 1521)

- [ ] **Step 1: Failing test** — extend `a failing chunk with preExisting declared still clears its record, with no crash (#4040)` to read `path.join(r.gitDir, 'claude-tweaks-verify', 'report.json')` after the failing chunk and assert `report.preExistingAdjudicated.fixed === null` and `report.preExistingAdjudicated.fixedReason === 'scope mode stamp-suite did not run every suite'`. Prove discrimination: temporarily change the mode at the call to `'full'` and confirm the test goes red, then restore.
- [ ] **Step 2: Implement** — add `const STAMP_SUITE_MODE = 'stamp-suite';` next to `KNOWN_SCOPES` with a one-line comment that it is deliberately outside `KNOWN_SCOPES` (a chunk runs a caller-chosen subset, so `newAndFixed` reports it as non-full); replace the bare literal in `mode: sel ? sel.mode : 'stamp-suite'` with `STAMP_SUITE_MODE`.
- [ ] **Step 3: Run** `node --test tests/bin-lib/verify/cli.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `Name the stamp-suite verify mode — pin its pre-existing report in the #4040 test, refs #4072`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (named constant, used at the call) → Step 2; Deliverable 2 (assert `fixed === null` + stamp-suite `fixedReason`) → Step 1. AC "no bare `'stamp-suite'` literal at the newAndFixed call" → Step 2; AC "extended test goes red when mode is `'full'`" → Step 1's discrimination check; AC "`npm test` passes" → Common Step 5 verification.
- **Placeholders:** none.
