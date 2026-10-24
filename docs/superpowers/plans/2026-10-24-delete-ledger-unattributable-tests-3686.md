# delete-ledger / finish-console unattributable arms + inherited-only report (#3686) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the two CLI `unattributable` arms and `resolveWorktreeBase` with direct tests, and make `hooks.js delete-ledger` name inherited-only docs/plans ledgers in its not-found report.

**Architecture:** Tests only for `wrap-up-engine.js finish-console` and `pack.js resolveWorktreeBase`. One behavior change in `hooks.js delete-ledger`'s not-found branch: when no `--ledger` was passed, call `describeRunLedgers` (already exported by `plugin/bin/lib/wrap-up/ledger-write.js`); `report === 'none'` with a non-empty `others` list is the inherited-only case. `resolveLedgerPath`'s return shape is not touched.

**Tech Stack:** Node 18+, `node --test`, `node:assert`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T082713-record-3686/spec-3686/work/3686-spec.md`

## Global Constraints

- `resolveLedgerPath`'s decision contract and return shape stay unchanged.
- The unattributable condition comes from the run-state `worktree` (a non-git temp dir), never from a non-git run dir — the run dir must stay anchored under a real git repo (finish-console's `#790`/`[IL-127]` guard).
- finish-console only reaches the ledger arm with a non-empty `ledger` payload.
- A run with no docs/plans ledger at all still prints exactly `no ledger found for {run} — not found`.
- The inherited-only run deletes nothing.

## Review Focus

- `--ledger <missing path>` (explicit, not-found): must not print an inherited-ledger diagnostic derived from the worktree scan — keep the plain not-found line. Pinned in Task 1 (guard on `!ledgerArg`).
- A `{run-dir}/ledger.md` already deleted and docs/plans holding only inherited ledgers: the inherited line still prints, nothing deleted. Covered by Task 1's inherited-only test.
- Unattributable delete-ledger: ledger file must survive. Asserted in Task 1.
- finish-console unattributable: the docs/plans ledger text byte-identical and no run-dir artifact written. Asserted in Task 2.
- `resolveWorktreeBase` with a throwing policy reader returns `null`, never throws. Task 3.

---

### Task 1: delete-ledger — unattributable CLI test and inherited-only report

**Files:**
- Modify: `plugin/bin/hooks.js` (the `delete-ledger` branch, not-found `else if (!resolved.ok)` arm, ~line 1125)
- Test: `tests/delete-ledger-verb.test.js`

**Interfaces:**
- Consumes: `describeRunLedgers({ runDir, worktree })` → `{ report: 'found'|'none'|'ambiguous'|'unattributable', ledgers, others, unattributed, detail }` from `./lib/wrap-up/ledger-write`.

- [ ] **Step 1: Write the failing tests** in `tests/delete-ledger-verb.test.js`:
  - `delete-ledger: unattributable arm — a non-git run-state worktree prints "cannot attribute" and keeps the ledger`: `gitRoot()` + `runDirFixture(root)`, then overwrite `run-state.json` with `{ status: 'active', worktree: <fresh non-git mkdtemp dir> }`; that dir holds `docs/plans/2026-08-14-x-ledger.md`. Assert stdout matches `/cannot attribute docs\/plans ledgers to 2026-08-14T120000-spec-999/` and `/ledger not deleted/`; assert the ledger file still exists.
  - `delete-ledger: inherited-only docs/plans ledgers are named in the not-found report`: same setup as the existing inherited test (commit `docs/plans/2026-08-14-old-ledger.md` on main, checkout `feature`). Assert stdout matches `/only inherited ledgers found: .*2026-08-14-old-ledger\.md/` and `/not found/`; file still exists.
  - Strengthen the existing "already-deleted" test (no docs/plans at all): assert stdout matches exactly `/no ledger found for 2026-08-14T120000-spec-999 — not found\n$/` and does not match `/inherited/`.

- [ ] **Step 2: Run** `node --test tests/delete-ledger-verb.test.js` — Expected: the unattributable test PASSES already (arm exists); the inherited-only test FAILS (no `only inherited ledgers found`).

- [ ] **Step 3: Implement** in `hooks.js` delete-ledger's not-found arm: when `!ledgerArg`, compute `describeRunLedgers({ runDir, worktree })`; if `view.report === 'none' && view.others.length > 0`, print `claude-tweaks: delete-ledger: no ledger found for {basename(runDir)} — only inherited ledgers found: {others joined ', '} — not found\n`; otherwise print the existing line unchanged. Update the branch comment to cite #3686.

- [ ] **Step 4: Run** `node --test tests/delete-ledger-verb.test.js` — Expected: all PASS. Then temporarily remove the `unattributable` arm in hooks.js and re-run: the unattributable test must go red; restore.

- [ ] **Step 5: Commit** — `git add plugin/bin/hooks.js tests/delete-ledger-verb.test.js`, message `Name inherited-only ledgers in delete-ledger's not-found report — refs #3686`.

### Task 2: finish-console — unattributable pre-flight arm test

**Files:**
- Test: `tests/bin-lib/wrap-up/finish-console-cli.test.js`

- [ ] **Step 1: Write the test** `finish-console unattributable arm: a non-git run-state worktree refuses the ledger pre-flight, ledger byte-identical`: `runDir = makeRunDir()` (anchored under `repoDir`); a fresh non-git mkdtemp `wt` (cleaned via `t.after`) holding `docs/plans/a-ledger.md` = `LEDGER_SAMPLE`; write `run-state.json` `{ worktree: wt }` into `runDir`; run `finish-console --run-dir runDir --approve-all` with `PREFLIGHT_PAYLOAD`. Assert `status === 1`, stderr matches `/ledger pre-flight failed: cannot attribute docs\/plans ledgers to this run/` and `/nothing written/`, `fs.readFileSync(ledger) === LEDGER_SAMPLE`, and no `verify-expectations.json`/`decisions.md` in `runDir`. (Place it after the `PREFLIGHT_PAYLOAD` definition.)

- [ ] **Step 2: Run** `node --test tests/bin-lib/wrap-up/finish-console-cli.test.js` — PASS. Temporarily replace the `unattributable` ternary arm in `wrap-up-engine.js` with the fallthrough and re-run: the new test goes red; restore.

- [ ] **Step 3: Commit** — `Test finish-console's unattributable ledger pre-flight arm — refs #3686`.

### Task 3: resolveWorktreeBase unit tests

**Files:**
- Test: `tests/bin-lib/wrap-up/pack.test.js` (add `resolveWorktreeBase` to the existing destructured require)

- [ ] **Step 1: Write the tests**:
  - `resolveWorktreeBase returns the merge base against origin/{integration-branch} when one resolves`: deps `{ resolvePolicy: policyFake(DEFAULT_POLICY), git: (args) => args[0]==='merge-base' && args[2]==='origin/main' ? 'abc123\n' : '' , ghSync: () => { throw new Error('no gh'); } }` → `'abc123'`.
  - `resolveWorktreeBase returns null when git fails`: git always throws → `null`.
  - `resolveWorktreeBase returns null when the policy read throws`: `resolvePolicy` throws → `null` (no throw escapes).

- [ ] **Step 2: Run** `node --test tests/bin-lib/wrap-up/pack.test.js` — PASS.

- [ ] **Step 3: Commit** — `Unit-test resolveWorktreeBase — refs #3686`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Task 1 test 1; Deliverable 2 → Task 2; Deliverable 3 → Task 3; Deliverable 4 + AC3/AC4 → Task 1 tests 2–3 and Step 3; AC2 (revert → red) → Task 1 Step 4, Task 2 Step 2; AC5 (`npm test`) → build's Common Step 5.
- **Placeholders:** none.
