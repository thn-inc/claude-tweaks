# Windows regression: 1 test file(s) newly failing after ff0fc67ab (#4287) Implementation Plan

**Goal:** Make the #4180 reap-merged dry-run test supply its closed-unmerged PR state through an injected `prStates` resolver instead of a PATH `gh` stub, so it runs and passes on every platform (Windows included).

**Spec:** `.claude-tweaks/pipelines/2026-10-28T110051-record-4287/spec-4287/work/4287-spec.md` (materialized from GitHub issue #4287)

---

### Task 1: Inject prStates into the #4180 dry-run test in place of installGhWrapper

**Files:**
- Test: `tests/bin-lib/reconcile/reap-merged.test.js` (the `#4180 reapMerged: a dry run reports a closed-unmerged skip without appending a worktree-reap-skipped event` test)
- Waived `plugin/bin/lib/reconcile/reap-merged.js`: reference only (`prStates` option)
- Waived `plugin/bin/lib/reconcile/pr-state-cache.js`: reference only (`createPrStateResolver`)

Base-state note: since the spec was shaped, #4285 (dd46c48db) gave this test `{ skip: STUB_SKIP }` from `tests/helpers/path-stub.js`, so on Windows it is skipped today rather than failing. Remove that skip as part of this task — the injected test spawns no `gh` and needs no skip.

- [ ] **Step 1: Failing test** — rewrite the #4180 test per the spec's Technical Approach (mirror the subject half of the `reapMerged: prStates answers replace live lookups (#4032)` test): build the fixture with `buildReapableFixture()`, construct `createPrStateResolver({ root, deps: { byBranch: () => ({ number: 7, state: 'CLOSED', mergedAt: null, updatedAt: '2026-01-01T00:00:00Z' }) } })`, and call `reapMerged({ cwd: root, dryRun: true, prStates })`. Drop the `installGhWrapper` call and its try/finally, and drop the `{ skip: STUB_SKIP }` option. Keep the three assertions byte-for-byte: skip reasons `['pr-closed-unmerged']`, worktree still present, no `events.jsonl` in the run dir.
- [ ] **Step 2: Implement** — no production change (Deliverable 2: leave every other stub-based test in the file alone).
- [ ] **Step 3: Run** `node --test tests/bin-lib/reconcile/reap-merged.test.js` — PASS, same test count as before. Then prove discrimination in a scratch `git worktree add` (never in this shared worktree): remove the `!dryRun` guard on the skip-event append in `plugin/bin/lib/reconcile/reap-merged.js` (around `:241`) and show the #4180 test goes red; quote the raw output.
- [ ] **Step 4: Commit** — one commit, `Inject prStates into the #4180 reap-merged dry-run test — refs #4287`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 1; Deliverable 2 → Step 2 (no other test touched). AC "passes with three assertions unchanged" → Steps 1 and 3; AC "no installGhWrapper, no PATH_STUB_SKIP" → Step 1 (also drops `STUB_SKIP`); AC "goes red without the `!dryRun` guard" → Step 3; AC "`npm test` passes" → `/build` Common Step 5; AC "windows-regression.yml dispatch" → post-build platform proof, outside this task.
- **Placeholders:** none.
