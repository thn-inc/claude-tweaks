---
files:
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/hooks/run-integrity.js
  - plugin/bin/lib/reconcile/mirror-ff.js
  - plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md
---

# Archive a Merged Run Only After Main Catches Up

**Persona:** A maintainer of a `pr-first` claude-tweaks repo who merges several dispatched PRs in a row. Their main checkout sits on `main` while it is a few commits behind `origin/main`, because it is dirty or simply not fetched yet.
**Goal:** Every merged run's directory gets archived whole. The gitignored half and the tracked `work/{n}-spec.md` move into `archive/{run-id}/` together, and no state-less directory holding only a spec is left behind once `main` fast-forwards.
**Entry point:** Any reconcile pass that runs the `archive` check after a PR merges on GitHub: SessionStart's background reconcile, dispatch's drain-end `reconcile --checks mirror,release,archive,reap`, or a hand-run `node bin/hooks.js reconcile`.
**Success state:** While `main` is behind, the run directory stays intact and the pass reports it as `local-behind-merge`. On the first pass after `main` fast-forwards, the run moves to `.claude-tweaks/pipelines/archive/{run-id}/` with its spec `git mv`'d in one `[reconcile] archive run {run-id}` commit. `git status --porcelain -- .claude-tweaks/pipelines` stays empty.

## Steps

### 1. The PR merges while main is behind, and the run waits
- **Action:** A reconcile pass reaches the merged run. The main checkout is on `main`, and local `main` lacks the PR's merge commit, while `origin/main` has it. `localHasMerge` answers from the checked-out branch and ignores `origin/main`, so the pass skips the run with `local-behind-merge` and moves nothing. The same rule covers a stale `interrupted` run whose work shipped: its branch must already be merged into local `main`, by ancestor or by a squash-merge patch match, before it is archived.
- **Should feel:** Patient, not stuck. The run is simply waiting its turn.
- **Should understand:** `local-behind-merge` is a retryable skip, not a stuck one. It never escalates to the structurally-stuck record, and it clears by itself once local `main` catches up.
- **Red flags:**
  - `archive/{run-id}/` appears holding `run-state.json`/`decisions.md` but no `work/`, while the old path is left with only `work/{n}-spec.md` (the pre-#4387 half-archive).
  - `local-behind-merge` escalating to a structurally-stuck record.

### 2. Main fast-forwards and the same sweep archives the whole run
- **Action:** Mirror fast-forwards local `main` to `origin/main`. It runs first in the same pass, when the main checkout is clean. The spec now exists in the main checkout's tree. The archive check sees the merge locally and runs `archiveRunDir`, which `git mv`s `work/` into `archive/{run-id}/work/` and commits it with the gitignored half in one `[reconcile] archive run {run-id}` commit.
- **Should feel:** Invisible. The maintainer did nothing and the archive looks like any other.
- **Should understand:** The archive waits on mirror's fast-forward, not just on the fetch. A dirty main (`mirror ff declined — dirty`) keeps every run on it waiting at `local-behind-merge` until the tree is clean.
- **Red flags:**
  - The archive commit renames the spec but leaves an untracked `archive/{run-id}/` copy.
  - A second commit is needed for `work/`.

### 3. A consumer project's reconcile state never blocks the fast-forward
- **Action:** A consumer project runs `/claude-tweaks:init`. Its gitignore suggestions now include `.claude-tweaks/reconcile-cache.json` and `.claude-tweaks/reconcile-background-status.json`. A project initialized earlier gets them through the migration row. Each reconcile pass writes these two files into the main checkout. Once they are ignored, they no longer make the tree read as dirty.
- **Should feel:** Like setup that just works. Nobody has to diagnose why archives never land.
- **Should understand:** An untracked reconcile cache in the main checkout counts as dirt to mirror's `git status --porcelain` check. Without these lines, mirror refuses every fast-forward, and step 1's wait never ends.
- **Red flags:**
  - A consumer SessionStart that shows `mirror ff declined — dirty` on every pass, with `git status` listing only `.claude-tweaks/reconcile-cache.json`.

### 4. A dry-run preview shows what the real pass will do
- **Action:** The maintainer runs `node bin/hooks.js reconcile --dry-run --json` while `main` is behind. Mirror reports `skipped` / `dry-run`. The archive preview assumes that fast-forward succeeds, reads `origin/main`'s ancestry, and lists the run under `archived`, while nothing moves and local `main` is not touched.
- **Should feel:** Trustworthy for the common case. The preview matches what the next real pass does on a clean main.
- **Should understand:** The preview is optimistic about the fast-forward. On a dirty, diverged or ahead main, the real pass skips `local-behind-merge` even though the preview said `archived`.
- **Red flags:**
  - A dry-run that moves files or fast-forwards `main`.
  - A dry-run that reports `local-behind-merge` for a clean, behind `main` whose real pass would archive.

## Origin
- Created during build of #4387 (reconcile archive-merged strands tracked work/ specs when the local integration branch is behind origin)
- All steps built in this session
- Related specs: #2565 (a parked checkout and no local integration ref keep the `origin/{integration}` fallback), #1130/#657 (the original local-ancestry guard), #3630 (the dry-run preview's shared fetch). See `archive-a-stateless-run-dir-that-still-holds-its-spec.md` for recovering a directory stranded before this fix.
