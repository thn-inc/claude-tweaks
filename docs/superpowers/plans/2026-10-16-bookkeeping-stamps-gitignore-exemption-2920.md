# Bookkeeping-stamps gate blocks gitignored writes pre-PR (#2920) Implementation Plan

**Goal:** `checkBookkeepingStampsGate`'s `isStampsGateExemptTarget` exempts a file-tool write
target that `isUntrackedOrIgnored` proves gitignored in its own repo — the same exemption the
sibling worktree-required gate already grants (#1395) — so a gitignored scratch write (e.g. a
draft PR body composed before the PR exists) is allowed while tracked/not-ignored writes stay
denied with the existing "no PR is recorded" message.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T082202-record-2920/work/2920-spec.md`
(materialized from GitHub issue #2920)

---

### Task 1: Extend `isStampsGateExemptTarget`

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js`

- [ ] In `isStampsGateExemptTarget` (near line 1502), after the existing
      `isPipelineBookkeeping(repoRoot, targetPath) || isPolicyFile(repoRoot, targetPath)` check
      returns false, add a check for `isUntrackedOrIgnored(repoRoot, targetPath)` (the helper
      already defined and used by `checkWorktreeRequired`, ~line 285). Note `targetPath` here
      always comes from `fileToolTargetPath`, which itself already gates on
      `GATE_COVERAGE.tools` — so this exemption is inherently file-tool-only, matching the
      issue's "limited to file-tool writes" Gotcha with no extra scoping needed.
- [ ] On a true result, write the same `gate-exempt-gitignored` breadcrumb the worktree-required
      gate writes (~line 965-971): `ctxLib.appendEvent(ownedRun.dir, 'gate-exempt-gitignored',
      { tool, path, ...testTag }, ownedRun.attribution)`, reading `ctx.ownedRun` the same way
      and the `CT_HOOKS_TEST_MODE` test tag the same way, then return `true`.
- [ ] Keep the existing two checks' fail-closed posture unchanged — `indeterminate`/no
      `repoRoot` still returns `false` before any of the three checks run.
- [ ] Update the function's own header comment (currently describes only the two existing
      exemptions) to mention the third.

### Task 2: Tests

**Files:**
- Modify: `tests/hooks-bookkeeping-stamps-gate.test.js`

- [ ] Add: with a landed materialize commit and no recorded PR (`pr-first`), a `Write` to a
      gitignored path inside the worktree is **allowed**, and a `gate-exempt-gitignored` event
      is appended to the owned run's `events.jsonl`.
- [ ] Add: in the same state, a `Write` to a tracked or not-ignored path in the worktree is
      **still denied** with the existing "no PR is recorded" message (regression guard —
      proves the new exemption didn't widen past gitignored targets).
- [ ] Add: a **relative** target path to a gitignored-shaped file (e.g. `.env`) is still
      **denied** — the absolute-path-only guard applies to the new check the same as the other
      two in this function.
- [ ] Prove each new test actually discriminates: temporarily revert only the Task 1 code change
      (`git checkout -- plugin/bin/lib/hooks/pre-tool-use.js`), confirm the new allow-case test
      (and only that one) goes red, then restore the fix.

### Task 3: Verify

- [ ] `npm test` passes in full.
