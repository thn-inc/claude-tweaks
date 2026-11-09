---
files:
  - plugin/skills/_shared/pre-verification-catchup.md
  - plugin/skills/build/SKILL.md
  - plugin/skills/build/handoff-template.md
  - plugin/skills/test/verification.md
  - plugin/skills/_shared/git-discipline.md
---

# Verify a Build Once After the Base Moved

**Persona:** a maintainer of a `pr-first` project whose single-record `/claude-tweaks:flow #N` (or `/claude-tweaks:dispatch` firing, or standalone `/claude-tweaks:build` in a worktree) runs for hours while sibling records keep merging into the integration branch.
**Goal:** the full test suite runs once, on a tree that already contains the current base — not once in build and again in `/test` after the build phase exit's catch-up merge changed the tree.
**Entry point:** `/claude-tweaks:build` Common Step 5 (Final Verification), immediately after any Category A fix commit and before the verification run, per `plugin/skills/_shared/pre-verification-catchup.md`.
**Success state:**
- A branch that fell behind gets one merge commit and one `AUTO` line in `decisions.md` naming `{before short} → {after short}`, then the suite runs once on that merged tree and `VERIFICATION_SHA` is the post-merge HEAD.
- `/test` Step 1 runs no suite when the base did not move again: the Match branch, or a bookkeeping-only Mismatch that re-stamps HEAD.
- Every run that does not catch up leaves exactly one `SKIP` line saying why, and the build's Step 7 handoff names the outcome on its Verification list.

## Steps

### 1. Build decides whether this run catches up
- **URL:** `plugin/skills/_shared/pre-verification-catchup.md` "Scope"
- **Action:** build resolves the integration model with `resolve-policy.js --values integration-model --run "$PIPELINE_RUN_DIR"`. A `local-merge` run, a `current-branch` build, an unresolved model, and any multi-spec run (`MULTISPEC_SHARED_WORKTREE=1` or `MULTISPEC_PARALLEL_WAVE=1`) fetch nothing, merge nothing, and log one `SKIP` naming the reason.
- **Should feel:** Quiet and predictable. A run that should not merge never touches the network for this step.
- **Should understand:** Multi-spec runs skip on purpose — `flow/multispec-freshness.md`'s boundary check is a HARD-GATE that has to see upstream drift at the next spec boundary, so build must not absorb it first.
- **Red flags:**
  - A fetch-failed `SKIP` on a `local-merge` project.
  - A merge commit inside a multi-spec run's shared branch from this step.
  - Two `SKIP` lines for one run.

### 2. A behind branch is merged in before the suite
- **URL:** `plugin/skills/_shared/pre-verification-catchup.md` "Procedure", citing `plugin/skills/_shared/git-discipline.md`'s Catch-up (`auto`) steps 1-4
- **Action:** in every mode (`auto`, `confirm`, `interactive`, `hybrid`, standalone), build fetches the integration branch, records the pre-merge HEAD, and runs `merge --no-edit origin/{integration-branch}`. A conflict it can resolve confidently is committed before HEAD is compared; one it cannot is aborted (`merge --abort`) and logged `AUTO`, and the suite runs on the un-merged tree. A merge git refuses to start (untracked files it would overwrite) is aborted and logged `SKIP`.
- **Should feel:** Like the base was always current. No question is asked, and nothing is pushed — the build phase exit pushes the merged branch.
- **Should understand:** The merge adds no suite run: Common Step 5 runs the full suite anyway, and now runs it once, on the merged tree. It runs once per build — a re-run after a fix does not repeat it.
- **Red flags:**
  - A rebase or force push.
  - The suite starting with `MERGE_HEAD` set or conflict markers in the tree.
  - An "already contains" `SKIP` logged next to an abort or failure line.
  - Untracked files moved or deleted to get the merge through.

### 3. The outcome lands where the reader looks
- **URL:** `plugin/skills/build/SKILL.md` Common Step 5 **Catch up before verifying (#4343)**; `plugin/skills/build/handoff-template.md` `### Verification`
- **Action:** an advanced branch logs `merged origin/{integration-branch} before the verification run ({before short} → {after short})`; an already-current branch logs `condition: branch already contains origin/{integration-branch} → fallback: nothing merged`. The handoff's Verification list carries `- Pre-verification catch-up: …` with the merged / already current / aborted / skipped outcome — the place a standalone build reports it.
- **Should feel:** Traceable — the before and after SHAs explain why `VERIFICATION_SHA` differs from the pre-verification HEAD.
- **Should understand:** Git-supplied text (the branch name) goes into `decisions.md` through `--text-file`, never a quoted `--text`.
- **Red flags:**
  - A merge with no `decisions.md` line.
  - A standalone build whose handoff is silent about the catch-up.

### 4. `/test` runs no second suite
- **URL:** `plugin/skills/test/verification.md` "Skip-if-recent (for /flow pipelines)" Match and Mismatch bullets
- **Action:** `/test` Step 1 compares `VERIFICATION_SHA` with HEAD. Equal → the Match branch skips verification. A later ledger or other bookkeeping-only commit → the Mismatch branch's scoped run resolves to `none` and re-stamps HEAD. At the build phase exit the Post-push merge-state check normally reads `no-conflict`.
- **Should feel:** Fast — the test phase finishes in seconds instead of re-running the full suite.
- **Should understand:** A base that moves during verification is the residual case: the build phase exit's Post-push merge-state check still catches it, as before.
- **Red flags:**
  - `/test` re-running the full suite on an unchanged base.
  - The Post-push check reporting `conflicting` on a build whose base did not move during verification.

## Origin
- Created during `/claude-tweaks:build` of record #4343 (2026-10-31). Build's Common Step 5 now runs a pre-verification catch-up for single-spec `pr-first` worktree runs, so a run whose base moved during the build runs its full suite once instead of twice.
- Related:
  - `docs/journeys/notice-a-run-pr-gone-conflicting-at-phase-exit-2986.md`: the post-push merge-state check that still covers a base moving during verification.
