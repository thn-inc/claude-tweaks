---
files:
  - plugin/bin/archive-tracked-shells.js
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/reconcile/format-summary.js
  - plugin/bin/lib/hooks/context.js
---

# Archive Stranded Spec Shells in One PR

**Persona:** Maintainer of a `pr-first` claude-tweaks repo with `worktree-always: true`. Their integration branch still tracks dozens of live `.claude-tweaks/pipelines/{run-id}/` directories that hold only a `work/{n}-spec.md` (or `spec-{n}/work/`), each with a clean archive twin under `archive/{run-id}/`. Those runs finished long ago, and reconcile used to hide them because their twin is clean.
**Goal:** Get every stranded shell archived on the integration branch through one reviewable housekeeping PR, never as a commit on the main checkout, and without the PR merging before its checks finish.
**Entry point:** The reconcile summary line `archive stranded shells: node "${CLAUDE_PLUGIN_ROOT}/bin/archive-tracked-shells.js" --root "<root>"`, which a SessionStart background reconcile or `node bin/hooks.js reconcile --dry-run --json --checks archive` prints.
**Success state:**
- One open PR on `housekeeping/archive-tracked-shells`, stamped `<!-- tidy-housekeeping-pr -->`, that moves each shell to `archive/{run-id}/` or deletes it when its archived copy is byte-identical.
- The envelope's `pr.armed` or `pr.merged` matches what the forge actually did.
- `git rev-parse HEAD` on the main checkout is unchanged.
- After the merge, the next reconcile prints no stranded-shells line.

## Steps

### 1. Reconcile names the pile once
- **URL:** none (local reconcile summary or `--json` output)
- **Action:**
  - The archive check calls `iterRunDirsWithState` with `includeTrackedShells: true`, so a live directory holding only tracked `work/` next to a clean twin is no longer skipped.
  - Each one is reported as `archived-pending-tracked-move` with `shell: true` and the CLI command.
  - The summary prints a single `archive stranded shells:` line for the whole batch rather than one command per directory.
  - Without `worktree-always`, reconcile completes at most one shell in place per pass and leaves the rest to the CLI.
- **Should feel:** Like a single to-do, not a wall of warnings.
- **Should understand:**
  - A shell's twin must be clean to count. Its clean `run-state.json` is the proof that the run finished.
  - A split-state directory whose twin is not clean keeps the per-directory `archive-run` completion.
  - SessionStart's unfinished-run report and `resolveRun` still do not list the shells: the default iterator is unchanged.
- **Red flags:**
  - One CLI line per directory.
  - The stranded-shells line printed for a non-clean twin.
  - Shells appearing as unfinished runs in the SessionStart banner.

### 2. Preview the batch — `archive-tracked-shells.js --dry-run`
- **URL:** none (JSON envelope on stdout)
- **Action:** The maintainer runs the printed command with `--dry-run`. It enumerates shells read-only in the main checkout and prints `{ moved, deleted, conflicts, untwinned, untracked, pr: null }` without creating a branch, a worktree or a PR.
- **Should feel:** Safe to run anywhere.
- **Should understand:**
  - `untwinned` lists live tracked directories with no archive twin. The CLI never touches them, and each needs a hand classification (archive, keep or delete) in the PR body.
  - `untracked` lists clean-twin directories whose files git does not track. These are also left alone.
- **Red flags:**
  - Any new branch, worktree or commit after a dry run.
  - An untwinned directory listed under `moved`.

### 3. Run it — one scratch worktree, one branch, one PR
- **URL:** `https://github.com/{owner}/{repo}/pull/{n}`
- **Action:** The maintainer runs the command without `--dry-run`. The CLI then:
  - Creates a scratch worktree locked with `archive-tracked-shells (pid N)` on `housekeeping/archive-tracked-shells`, cut from `origin/{integration}`. If an open PR's branch already exists, it is reused and origin is merged into it.
  - Runs `archiveRunDir` for each shell. Each commit carries an explicit pathspec, so it never sweeps in unrelated staged content.
  - Pushes the branch.
  - Opens one PR, or reuses the open one and prints its URL.
- **Should feel:** One action, one reviewable diff.
- **Should understand:**
  - A re-run while the PR is open adds to the same branch and PR.
  - A re-run after it merged is a no-op that exits 0 with `moved` empty.
  - A shell absent from a stale branch, with no archived `work/` there, is reported `not-on-branch` and is not silently skipped.
  - A concurrent run whose locked worktree belongs to a live pid makes this run refuse with exit 2 and leave that worktree alone.
  - `--no-pr` commits locally and pushes nothing. In a repo with no `origin` it builds on the local integration branch.
- **Red flags:**
  - A commit on the main checkout's branch.
  - A second housekeeping PR.
  - A scratch worktree left behind after an exit.
  - Another run's locked worktree destroyed.

### 4. Arming follows the forge, not just the policy key
- **URL:** `https://github.com/{owner}/{repo}/pull/{n}/checks`
- **Action:**
  - With `housekeeping-auto-merge` resolving `true`, the CLI reads `mergeStateStatus`. It arms `gh pr merge --auto --squash` only on `BLOCKED`, where the forge holds the merge for required checks.
  - Any other value leaves the PR unarmed, with a note naming the value it read. For example, UNKNOWN means not yet computed, and the housekeeping backstop can arm it later; CLEAN means no required check holds it, so `--auto` would merge before CI.
  - A read after arming reports `armed` or `merged` truthfully. A rejected arm records `armError` and still exits 0.
- **Should feel:** As safe as tidy's housekeeping merge: nothing merges ahead of its checks.
- **Should understand:** On a repo with no required checks, the PR waits for a human or for the tidy sweep's housekeeping-PR backstop, which recognises the `tidy-housekeeping-pr` marker.
- **Red flags:**
  - `mergedAt` earlier than a check's completion.
  - An envelope saying `armed: true` for a PR that already merged.
  - An unarmed note giving the wrong cause for the state it read.

### 5. Read the exit code
- **URL:** none
- **Action:** The CLI exits with one of three codes:
  - 0 when every shell was handled, including when there was nothing to do.
  - 1 when a shell was left because its twin's `work/` differs. That shell is named in `conflicts` with the differing path, and the PR still opens for the clean shells.
  - 2 on a malformed call, an unsupported environment (`local-merge` or no `gh`, without `--no-pr`), or an operational failure. On an exit 2 after shells were archived, it still prints the envelope with `branch` and `error`.
- **Should feel:** Scriptable and honest.
- **Should understand:** Untwinned directories do not raise the exit code. Read the envelope for them.
- **Red flags:**
  - An exit 2 with no envelope after commits landed.
  - A left-behind conflict reported as exit 0.

## Origin
- Created during the build of #3975 (report stranded spec-shell dirs, ship a command that archives them via one PR, and stop `archiveRunDir` committing the whole index).
- All steps were built in this session.
- Related: #3721 (archival commit reporting), #4467 (tidy housekeeping PR waits for its checks), #3976 (moving new runs' headers before merge).
