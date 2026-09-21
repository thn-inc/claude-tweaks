---
files:
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/hooks/git-exec.js
  - plugin/bin/hooks.js
  - plugin/skills/_shared/pipeline-run-dir.md
---

# Archive a State-less Run Dir That Still Holds Its Spec

**Persona:** Maintainer of a `pr-first` claude-tweaks repo whose SessionStart lists a run dir as "status: unknown" — a run whose record already shipped and closed, but whose directory under `.claude-tweaks/pipelines/` holds only the git-tracked `work/{n}-spec.md` because the run's `run-state.json`/`decisions.md`/`config.yml` only ever existed in the worktree copy.
**Goal:** Get that leftover directory archived without leaving the main checkout's working tree dirty, and understand along the way why the manual close verbs refuse it.
**Entry point:** Running the SessionStart-suggested `node bin/hooks.js close-run --run .claude-tweaks/pipelines/{run-id}` against the listed directory.
**Success state:** The directory is under `.claude-tweaks/pipelines/archive/{run-id}/` with its spec still git-tracked at the new path, recorded by one `[reconcile] archive run {run-id}` commit in the main checkout; `git status --porcelain -- .claude-tweaks/pipelines` shows no unstaged ` D` deletion or untracked `archive/{run-id}/` copy; the next SessionStart no longer lists the run.

## Steps

### 1. `close-run` refuses, and says who owns the directory
- **Action:** The maintainer runs the `close-run` command SessionStart printed. `hooks.js` rejects it: the path exists under the main checkout but is not an initialized run dir (none of `decisions.md`/`run-state.json`/`config.yml`). Trying `archive-run` on the same path is refused too, with the message that a state-less dir is reconcile's orphaned-mint sweep's job — naming both `archiveOrphanedMint` and, for a dir that still holds tracked content, `archiveRunDir`.
- **Should feel:** Redirected, not stuck — the refusal points at the mechanism that will handle it, not at a dead end.
- **Should understand:** Nothing is wrong with the record; the manual verbs only close runs that carry state, and a state-less leftover is swept automatically once it is older than the orphaned-mint grace window (24 hours since the directory was last touched).
- **Red flags:** A refusal that names only `archiveOrphanedMint` for a directory that visibly holds a tracked spec (the pre-#2227 wording); any suggestion to `git rm` or hand-move the directory.

### 2. The next reconcile pass archives it through git, not the filesystem
- **Action:** After the grace window, a reconcile pass (`archiveMerged`, run by SessionStart's background reconcile or a dispatch/tidy pre-step) reaches the orphaned-mint branch. `hasTrackedContent` asks `git ls-files -- {dir}`; the answer is non-empty, so the directory goes through `archiveRunDir` — a `git mv` of `work/` into `archive/{run-id}/work/` plus one `[reconcile] archive run {run-id}` commit — instead of `archiveOrphanedMint`'s bare `fs.renameSync`. A directory with nothing tracked still takes the fs-only move, with no commit.
- **Should feel:** Invisible and clean — the maintainer did nothing, and the main checkout's `git status` stays empty for the pipelines path afterward.
- **Should understand:** The archive is a real commit on the integration branch's local ref, so the spec's history follows it; the pre-#2227 behavior (an unstaged ` D` on the spec plus an untracked `archive/` copy that nothing committed) no longer happens for this shape.
- **Red flags:** An unstaged ` D .claude-tweaks/pipelines/{run-id}/work/{n}-spec.md` plus `?? .claude-tweaks/pipelines/archive/{run-id}/` in main after a sweep; any failed `git ls-files` probe — a timeout under load, or a definitive git error such as a corrupt index — being read as "untracked" and routing the directory back to the bare rename (only a successful, empty listing proves "untracked": `hasTrackedContent` treats every `runGit` failure from `git-exec.js` as tracked, and lets `archiveRunDir` refuse visibly instead).

### 3. A refused git-aware archival is visible, never silent
- **Action:** If `archiveRunDir` refuses the routed directory (a failing commit, a tracked file outside `work/`), the pass records the directory in its `skipped` list with `archiveRunDir`'s own reason (`commit-failed`, `tracked-entry`, …), restores `work/` to its original path, and leaves the directory in place for the next pass. SessionStart's "background reconcile (from a prior session)" summary carries the skip reason.
- **Should feel:** Honest — a directory that could not be archived says why, rather than half-moving.
- **Should understand:** The directory will be retried on later passes; a persistent `tracked-entry` skip means something other than the spec is tracked inside the run dir and needs a human look.
- **Red flags:** A refusal that leaves `work/` at the archive path with the old path deleted; a skip with no reason string.

## Origin
- Created during build of #2227 (reconcile: archiveOrphanedMint fs-renames a git-tracked work/ spec with no git mv or commit, leaving main's working tree dirty)
- All steps built in this session
- Related specs: #2241 (follow-up — `archiveRunDir`'s archival commit carries no pathspec and can sweep unrelated staged content), #1732 (archive-merged.js consolidation; carries the tracked-entry no-escalation and glob-pathspec observations)
