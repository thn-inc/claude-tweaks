---
files:
  - plugin/bin/archive-run-header.js
  - plugin/bin/lib/run-header-archive.js
  - plugin/skills/wrap-up/execution-and-verification.md
  - plugin/skills/wrap-up/auto-merge-short-circuit.md
  - plugin/skills/wrap-up/cleanup-procedures-execution.md
  - plugin/skills/flow/multispec-review-console.md
  - plugin/skills/flow/worktree-merge.md
  - .gitignore
---

# Merge a Run With Its Spec Header Already Archived

**Persona:** Maintainer of a claude-tweaks repo whose `/flow` and `/dispatch` runs merge through wrap-up. Their `main` keeps gaining live `.claude-tweaks/pipelines/{run-id}/work/` directories after each merge, plus `[reconcile] archive run` commits that leave local `main` ahead of origin.
**Goal:** Have each run's tracked spec header land on `main` already under `archive/{run-id}/`, so a merge leaves no live tracked run directory and needs no post-merge reconcile commit.
**Entry point:** Wrap-up's merge path for a run with a reachable worktree: the pr-first Branch finish, the auto-merge short-circuit, Section C's local-merge finish, or a multi-spec run's Shared teardown step 0.
**Success state:**
- The run branch's last header-touching commit is `Archive run {run-id} spec header — moved to archive/ before merge`.
- After the merge, `git ls-tree origin/main .claude-tweaks/pipelines/` lists no live directory for the run.
- No `[reconcile] archive run {run-id}` commit appears for it.
- `decisions.md` carries one `AUTO … — Archive spec header: moved {n} file(s) …` line.

## Steps

### 1. Wrap-up runs the move before the push and the merge
- **URL:** none (wrap-up runs `node "${CLAUDE_PLUGIN_ROOT}/bin/archive-run-header.js" --run "{run-dir}"` as its own Bash call)
- **Action:**
  - The call comes after the pack, the first-call check and the bookends verification have read the live header, and before Phase exit's push, the short-circuit push, or the local-merge finish.
  - The CLI `git mv`s every tracked file under `work/` and `spec-{N}/work/` to `archive/{run-id}/` one file at a time.
  - It commits with an explicit pathspec, so untracked files under `work/` stay where they are.
- **Should feel:** Invisible: one more commit on the PR, nothing to answer.
- **Should understand:**
  - A multi-spec run moves every spec's header once, at Shared teardown step 0. Per-spec wrap-ups skip the move under `MULTISPEC_REVIEW_DEFER=1`.
  - A `--run` naming one `spec-{N}` directory moves only that spec's header.
- **Red flags:**
  - A move commit after the merge.
  - A move commit that also carries unrelated staged or unstaged edits.
  - Untracked agent files dragged into `archive/`.

### 2. Read the one-line outcome
- **URL:** none (stdout envelope and `decisions.md`)
- **Action:** The CLI prints `{ outcome, reason?, commit?, moved, push?, logged }` and exits 0 for each of three outcomes:
  - `moved`: it logs an `AUTO` line naming the file count and the short sha.
  - `noop`: nothing is left to move, for example on a re-entry. It logs nothing and reports `logged: true`.
  - `refused`: for example the archived copy differs, the index is dirty, or there is no worktree. It logs one `SKIP` line ending `→ fallback: header left live; reconcile's archiveRunDir archives it after the merge`.
- **Should feel:** Never a stop. A refusal is a log line, and the merge goes ahead.
- **Should understand:**
  - Exit 2 means a malformed invocation. Exit 3 means a `--run` not anchored under the main checkout.
  - An unexpected exception exits 1 with nothing logged, and wrap-up logs the `SKIP` itself.
  - Only `logged: false` asks wrap-up to hand-log the line.
- **Red flags:**
  - A refusal that blocks the merge.
  - A second `AUTO` line on a re-run.
  - A hand-logged line for a noop.

### 3. Merge and see a clean `main`
- **URL:** `https://github.com/{owner}/{repo}/pull/{n}` (pr-first) or the local integration branch (local-merge)
- **Action:**
  - The squash or local merge lands the header at `archive/{run-id}/work/{n}-spec.md`.
  - The next reconcile archives only the gitignored half and makes no `[reconcile] archive run` commit.
  - A run merged without the move, for example one merged by an older release or a refused move, still gets the post-merge `archiveRunDir` commit, unchanged.
- **Should feel:** Like nothing is left to clean up.
- **Should understand:**
  - Readers that ran before the move used the live path.
  - Later readers resolve the archived path: `bin/lib/run-header.js`'s resolver, local-merge reconciliation's `{issues}` binding, and the verification brief's `--spec` candidate.
  - `.gitignore` now tracks only `work/*-spec.md`, so ad hoc files under `work/` are no longer committed.
- **Red flags:**
  - A live `pipelines/{run-id}/` directory on `main` after a moved run merges.
  - Local `main` ahead of origin by a reconcile archive commit.
  - A parked local-merge branch reconciled later that merges with no `Fixes` line.

## Origin
- Created during the build of #3976 (archive the spec header on the run branch before merge).
- All steps were built in this session.
- Related: #3974 (dual-path header resolver), #3975 (stranded shells and `archiveRunDir`'s explicit pathspec), #3855 (where the move should happen).
