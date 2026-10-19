# Windows regression: 2 test file(s) newly failing after 5cf9073d3 (#3506) Implementation Plan

**Goal:** Make the two reconciler suites (`pr-state.test.js`, `release-merged.test.js`) pass on a Windows checkout without changing plugin behavior.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T082347-record-3440/spec-3506/work/3506-spec.md` (materialized from GitHub issue #3506)

---

### Task 1: Real-directory repoRoot and per-test win32 skip for gh PATH stubs

**Files:**
- Modify: `tests/bin-lib/reconcile/pr-state.test.js`
- Modify: `tests/bin-lib/reconcile/release-merged.test.js`
- Test: both files above
- Reference (no change): `plugin/bin/lib/reconcile/pr-state.js` (`execFileSync('gh')` call sites, `byNumberArgsValid`, `classifyByNumberError`), `tests/console-execute.test.js` (existing `{ skip: process.platform === 'win32' }` precedent, line ~443)

- [ ] **Step 1: Failing test** — none to add (test-only parity change). The pre-change evidence is the spec's Windows log; on POSIX record the baseline `node --test tests/bin-lib/reconcile/pr-state.test.js tests/bin-lib/reconcile/release-merged.test.js` summary lines before editing.
- [ ] **Step 2: Implement**
  1. `pr-state.test.js`: add one module-level constant `const REPO_ROOT = os.tmpdir();` and replace every POSIX literal `'/tmp'` passed as a repoRoot/cwd (including `{ cwd: '/tmp' ... }` object arguments in the #3029 guard tests) with `REPO_ROOT`. Leave `'/definitely/not/here'` and `'/tmp/definitely-not-a-repo-xyz'` untouched.
  2. Both files: add one per-file constant, exactly
     `const PATH_STUB_SKIP = process.platform === 'win32' && 'win32: execFileSync("gh") never spawns a #!/bin/sh stub named gh on PATH';`
     and pass it as `{ skip: PATH_STUB_SKIP }` (the `test(name, options, fn)` form) on **every** `test(` whose body, or a helper it calls, writes a file named `gh` into a PATH-prepended directory: callers of `installGhWrapper` / `installArgvSpy` / `installArgvLoggingGhWrapper` (pr-state; this includes the three #3029 guard tests that install a spy only to assert `gh` was never called), every inline `wrapperPath = path.join(wrapperDir, 'gh')` block (release-merged), and every test that runs through `run3348Scenario` or `runTwoCandidateScenario`. **Re-derive the set from the files as they are now** (the spec counted 22 in pr-state and 17 in release-merged; #3416 or another merge may have changed that) — record the final per-file counts and test names in the report.
  3. Tests that install no stub must NOT carry the constant: pure `decideRelease` / `prClosesIssue` / `shouldSkipClaimRead` / `needsIssueEvidence` / `releasedEntry` tests, injected-runner `resolvePrStatesBulk` tests, injected-`ghApi` `releaseMerged` tests, the falsy-number short-circuit test, the "no branch/no number -> null" tests, and the PATH-emptied gh-absent tests (including the three by-number gh-absent tests: `resolvePrStateByNumber: gh absent`, `resolveIssueStateByNumber: gh absent`, `resolvePrStateByNumberAsync: gh absent`).
  4. Never stub `process.platform`; never skip a whole file; no change under `plugin/`.
- [ ] **Step 3: Run** `node --test tests/bin-lib/reconcile/pr-state.test.js tests/bin-lib/reconcile/release-merged.test.js` — PASS with zero failures and zero skipped tests on POSIX; quote the raw `ℹ tests` / `ℹ pass` / `ℹ skipped` (or `# tests` / `# pass` / `# skipped`) lines. Also confirm: `grep -c "os.tmpdir()" tests/bin-lib/reconcile/pr-state.test.js` is at least its previous count plus one, and `grep -n "'/tmp'" tests/bin-lib/reconcile/pr-state.test.js` returns nothing (the `'/tmp/definitely-not-a-repo-xyz'` literal does not match `'/tmp'`).
- [ ] **Step 4: Commit** — one commit, `Skip gh PATH-stub reconciler tests on win32 and use a real repoRoot — refs #3506`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2.1; Deliverable 2 → Step 2.2-2.3. AC1 (`'/tmp'` gone, `os.tmpdir()` count +1) → Step 3 greps; AC2 (every stub-writing test carries the constant, every other test does not) → Step 2.2-2.3 with the re-derived list in the report; AC3 (POSIX zero skipped, raw lines) → Step 3; AC4 (next windows-latest run) is post-merge / covered by the run's windows-regression workflow_dispatch; AC5 (`npm test`) → `/build` Common Step 5.
- **Placeholders:** none.
