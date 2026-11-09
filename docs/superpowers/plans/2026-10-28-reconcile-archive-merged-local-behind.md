# Reconcile archive-merged local-behind guard (#4387) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop reconcile's archive-merged sweep from archiving a merged run while the main checkout, checked out on the integration branch, is still behind the merge — the case that strands the tracked `work/{n}-spec.md`.

**Architecture:** `localHasMerge(root, mergeCommit, integration)` in `plugin/bin/lib/reconcile/archive-merged.js` gains one branch: when the main checkout's `HEAD` is the integration branch itself, the local ref is authoritative and the `origin/{integration}` fallback is not consulted (returns `false` → the existing retryable `local-behind-merge` skip). Every other shape (parked on another branch, detached HEAD, no local integration ref) keeps #2565's local-then-origin behavior unchanged. Both callers (`archiveMergedRun` and the by-number fallback in `archiveMerged`) already map `false` to `local-behind-merge`, so no caller changes.

**Tech Stack:** Node 18+, `node --test`, real git fixtures (no mocks for git).

**Spec:** `.claude-tweaks/pipelines/2026-10-28T131244-record-4387/work/4387-spec.md`

## Global Constraints

- The retry reason is the existing `local-behind-merge` string — it is absent from `STRUCTURALLY_STUCK_REASONS`, so it is retryable and never escalates.
- `localHasMerge` keeps its signature and its `true | false | null` contract; omitting `integration` keeps the bare HEAD check exactly as today.
- All git calls go through this file's own `runGit(args, cwd)` (repo-pinned env, `-C cwd`).
- Hand-written commit messages use `{Verb} {what} — {detail}` and end with `refs #4387`, never `closes`/`fixes`.

## Review Focus

1. Detached HEAD in the main checkout — `symbolic-ref` fails; must be treated as "not on the integration branch" (origin fallback kept), never as an error or a `null`. Pinned in Task 1's unit test.
2. Main checkout on the integration branch with the merge commit not even present in the local object store (never fetched) — `merge-base` exits 128, must still return `false` (retryable), not `null`. Covered by Task 1's on-integration test (local repo never fetched the oid → same `false`).
3. No local integration ref at all (fresh clone parked on another branch, `main` deleted) — must still archive via origin (#2565). Pinned in Task 1.
4. After the local branch fast-forwards, the same sweep must archive and `git mv` `work/` in one commit — pinned by Task 2's second half.
5. An `integration` value that differs from HEAD only by being unset (standalone caller) — behavior unchanged (bare HEAD check); already pinned by `tests/reconcile.test.js`'s existing localHasMerge tests.

---

### Task 1: Make `localHasMerge` require the merge in the checked-out integration branch

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js:693-731` (the `localHasMerge` comment block and body)
- Modify: `docs/reconcile-checks.md:38` (the `archive` row's description of `localHasMerge`)
- Modify: `plugin/bin/lib/reconcile/index.js:64-65` (the `PREREQUISITES` comment restating the read order)
- Test: `tests/reconcile.test.js` (next to the existing `#2565` localHasMerge tests, after line 462)

**Interfaces:**
- Produces: `localHasMerge(root: string, mergeCommit: {oid: string} | null, integration?: string): true | false | null` — unchanged signature; new rule: when `git symbolic-ref --quiet --short HEAD` in `root` prints exactly `integration`, return the `refs/heads/{integration}` ancestry result without the `origin/{integration}` fallback.

- [ ] **Step 1: Write the failing tests** in `tests/reconcile.test.js`, using its existing `pairedFixture()` and `git(args, cwd)` helpers:

  - `localHasMerge: on the integration branch with local behind origin — reports false (no origin fallback, #4387)`: seed commits + pushes a new `main` commit (`mergeOid`); `mainDir` stays checked out on `main` and runs `git fetch -q origin main` (only `origin/main` advances). Assert `localHasMerge(mainDir, { oid: mergeOid }, 'main') === false`. Then `git merge -q --ff-only origin/main` in `mainDir` and assert it is `true`.
  - `AC3.1: localHasMerge parked with no local integration ref — still falls back to origin (#2565)`: same seed push; in `mainDir` `git checkout -q -b someone-elses-work`, `git branch -q -D main`, `git fetch -q origin main`. Assert `=== true`.
  - `localHasMerge: detached HEAD with local behind — still falls back to origin`: same seed push; in `mainDir` `git fetch -q origin main`, `git checkout -q --detach`. Assert `=== true`.

- [ ] **Step 2: Run to verify the first test fails**

  Run: `node --test --test-name-pattern="4387|no local integration ref|detached HEAD with local behind" tests/reconcile.test.js`
  Expected: the `#4387` test FAILS (`true !== false`); the other two PASS (they pin existing behavior).

- [ ] **Step 3: Implement** in `localHasMerge`: after the `!integration` early return and the `refs/heads/{integration}` check returning `true`, run `runGit(['branch', '--show-current'], root)` (the same probe `mirror-ff.js:44` uses to decide "checked out on the integration branch"; it prints an empty string on a detached HEAD); when it succeeded and its `stdout === integration`, return `false`. Otherwise fall through to the existing `origin/{integration}` check. Extend the comment block with a `#4387:` paragraph: the archive's `git mv` runs against this checkout's working tree, so on the integration branch the tracked `work/` only exists once the local branch has the merge; the origin fallback is for #2565's parked/no-ref shapes only. Update `docs/reconcile-checks.md:38` and `index.js:64-65` to say the origin fallback applies only when the main checkout is not on the integration branch.

- [ ] **Step 4: Run to verify all pass**

  Run: `node --test tests/reconcile.test.js`
  Expected: PASS (including the pre-existing `#2565` tests at lines 416-462).

- [ ] **Step 5: Commit**

  ```bash
  git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/lib/reconcile/index.js docs/reconcile-checks.md tests/reconcile.test.js
  git commit -m "Require the merge on the checked-out integration branch before archiving — no origin fallback while main is behind, refs #4387"
  ```

### Task 2: Regression test — archiveMerged leaves a behind run in place, then archives after fast-forward

**Files:**
- Test: `tests/bin-lib/reconcile/archive-merged.test.js` (after the `#2226` by-number pair ending at line 3462)

**Interfaces:**
- Consumes: Task 1's `localHasMerge` rule; this file's `git(cwd, ...args)`, `installGhWrapper(prsJson, issueStates)`, `STRUCTURALLY_STUCK_REASONS`, `STUB_SKIP`.

- [ ] **Step 1: Write the test** `AC1.1 + AC2.1: archiveMerged main checkout on main but behind origin's merge — skips local-behind-merge, then archives with the work/ git mv once main fast-forwards (#4387)`, `{ skip: STUB_SKIP }`:

  Fixture (inline, realpath'd roots as the file's other fixtures do): a bare `origin` (`--initial-branch=main`); a `seed` clone that commits `a.txt`, pushes `main`; `root` = realpath of a second clone (user.email/user.name configured), checked out on `main`. In `seed`: commit `.claude-tweaks/pipelines/{runId}/work/4387-spec.md` (`'# spec 4387\n'`) and push `main`; `mergeOid` = seed's `main` tip. In `root`: `git fetch -q origin main` only. `runId = '2026-08-01T090000-record-4387-local-behind'`; in `root` create the run dir's gitignored half: `run-state.json` `{ status: 'active', worktree: <root>/.claude/worktrees/gone-4387, pr: { number: 4510, branch: 'feat-4387-gone' } }` and `console.json` `{ resolved: true }`. gh: `installGhWrapper({ number: 4510, state: 'MERGED', mergedAt, updatedAt, mergeCommit: { oid: mergeOid } }, { 4387: 'CLOSED' })`.

  First pass, `archiveMerged({ cwd: root, integration: 'main' })`:
  - `result.archived` does not include `runDir`; the `skipped` entry for `runDir` has `reason === 'local-behind-merge'`
  - `STRUCTURALLY_STUCK_REASONS.has('local-behind-merge') === false`
  - `runDir/run-state.json` still exists; `.claude-tweaks/pipelines/archive/{runId}` does not exist; `git rev-parse HEAD` unchanged

  Then `git merge -q --ff-only origin/main` in `root` (work/ arrives), second pass with the same arguments:
  - `result.archived` includes `runDir`; `runDir` no longer exists
  - `archive/{runId}/work/4387-spec.md` exists
  - `git show --name-status HEAD` contains both `.claude-tweaks/pipelines/{runId}/work/4387-spec.md` and `.claude-tweaks/pipelines/archive/{runId}/work/4387-spec.md` (the rename landed in one commit)

  Restore the gh wrapper in `finally` around each pass.

- [ ] **Step 2: Prove it discriminates** — temporarily revert Task 1's `branch --show-current` guard in `archive-merged.js` (scratch edit, not committed) and run:
  `node --test --test-name-pattern="4387" tests/bin-lib/reconcile/archive-merged.test.js`
  Expected: FAIL on the first pass (run archived ahead of the local checkout). Restore the code.

- [ ] **Step 3: Run with Task 1's code**

  Run: `node --test --test-name-pattern="4387" tests/bin-lib/reconcile/archive-merged.test.js`
  Expected: PASS

- [ ] **Step 4: Commit**

  ```bash
  git add tests/bin-lib/reconcile/archive-merged.test.js
  git commit -m "Add archive-merged regression test for a main checkout behind origin's merge — skip then archive after fast-forward, refs #4387"
  ```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Task 1 Step 3. Deliverable 2 → Task 1's parked/no-ref/detached tests plus the existing `#2565` tests. Deliverable 3 → Task 2. AC1 → Task 2 first pass. AC2 → Task 2 second pass. AC3 → Task 1 Steps 1/4.
- **Behavior-change prose sweep:** `git grep -n -i -e "localHasMerge" -e "falls back to .origin/" -e "falling back to .origin/" -- plugin docs .claude/skills` → `docs/reconcile-checks.md:38` and `plugin/bin/lib/reconcile/index.js:64` restate the read order (Modify, Task 1); `mirror-ff.js:53`, `squash-provenance.js:37` and `docs/journeys/keep-a-run-dir-until-every-record-its-merged-pr-left-open-ships-3503.md:54` only name the function (no change).
- **AC3.1** is also pinned by the pre-existing `tests/reconcile.test.js` #2565 parked-checkout tests (lines 416-452), which Task 1 Step 4 runs.
- **Placeholders:** none.
- **Type consistency:** `localHasMerge` signature unchanged across both tasks; skip reason string `local-behind-merge` used throughout.
