---
files:
  - plugin/bin/lib/hooks/teardown-run.js
  - plugin/bin/lib/hooks/close-run-state.js
  - plugin/bin/lib/wrap-up/engine-verify.js
  - plugin/bin/lib/residue/probes/release.js
  - plugin/skills/wrap-up/summary-template.md
  - plugin/skills/wrap-up/cleanup-procedures-execution.md
---

# Trust a Post-Merge Cleanup Verdict

**Persona:** an agent (or the human watching it) finishing a squash-merged `pr-first` run from a session that no longer owns its worktree — resumed after a context compaction on Windows, so `ExitWorktree remove` refuses and teardown has to go through `teardown-run --merged` from the main checkout.
**Goal:** know, from the cleanup output alone, whether the run's worktree folder is really gone and whether the release bookkeeping really has a gap — without opening a file browser or re-checking git by hand.
**Entry point:** `node bin/hooks.js close-run`, then `ExitWorktree keep`, then `node bin/hooks.js teardown-run --run <archived run dir> --merged`, then `wrap-up-engine.js verify` and the standalone `/claude-tweaks:wrap-up` residue sweep (`wrap-up-pack.js` → `residue.js --scope blast-radius`).
**Success state:** every "clean" line in the output is true on disk. A folder that survived removal is named as still present, `verify` fails `worktree-removed` with its path, the wrap-up report blocks on it, and the release probe proposes no CHANGELOG entry that already exists upstream.

## Steps

### 1. Teardown says what happened to the folder, not just the registration
- **Action:** `teardown-run` tries `git worktree remove`. On a half-reaped worktree (`prunable` in `git worktree list --porcelain`) it falls back to `git worktree prune`, then checks the path on disk. Folder gone → `worktree: removed via prune {path} (removal had failed: …)`. Folder still there (a Windows process holding a handle) → `worktree: registration pruned but directory still present at {path} (removal had failed: …)`. Every failed-removal line carries the cause: git's stderr, else `exit {status}` (plus stdout), else the failure category (`timeout`, `spawn`), and only then `no error text`.
- **Should feel:** Honest — a line that says "removed" means the folder is gone; a line that says "still present" hands over the exact path to delete.
- **Should understand:** Teardown never retries the delete and never exits non-zero for this — `docs/hooks.md`'s never-break-a-session rule. The still-present line is a report, and the caller (`cleanup-procedures-execution.md` step 5, `multispec-review-console.md` step 7) surfaces the path for manual removal instead of treating it as done. On Windows, git's porcelain prints the worktree as `D:/a/…/feat` while `run-state.json` stamps it as `D:\a\…\feat`. Both the `prunable` lookup and the branch lookup behind `--merged`'s `branch: deleted {branch}` line compare resolved paths, case-folded on Windows (`findWorktreeEntry`, #3695), so the separator and drive-letter case never decide a match.
- **Red flags:** `worktree: removed …` printed while the folder is still on disk, or `(removal had failed: no error text)` when git did exit with a status — the two false-clean signals #3023 was filed for. On Windows, `branch: skipped — no branch recorded` for a run whose `run-state.json` does record its worktree, or a `prunable` worktree reported as `skipped — removal failed` with no prune attempted — the #3695 path-shape mismatch.

### 2. Verify fails `worktree-removed` while the folder survives
- **Action:** `wrap-up-engine.js verify`'s `worktree-removed` row first checks `git worktree list` (still listed → `fail — worktree still listed: {path}`). When the worktree is unlisted, it reads the run's recorded path — `run-state.json`'s `worktree`, or `worktreeAtClose` once `close-run` has nulled `worktree` (a `spec-{N}/` dir also checks its parent) — and fails with `worktree unlisted but directory still present: {path}` if that path exists.
- **Should feel:** Consistent with Step 1 — teardown and verify never disagree about the same folder.
- **Should understand:** `close-run` writes `worktreeAtClose` precisely because every sanctioned removal path closes the run first; without it the on-disk check would have no path to look at and would pass by default. One exception (#3373): when the run's `console.json` records merge resolution `leave-open`, both of these fails render `skip (pending-review — teardown follows the human merge)` instead. That run's worktree is supposed to stay until a human merges the PR. The check reads only that recorded resolution, never the PR's live state, so a `leave-open` run that was later merged and torn down still reads `skip` here. For such a run, verify does not catch a folder that survived teardown; Step 1's `still present` line does.
- **Red flags:** `worktree-removed: pass` for a run whose recorded worktree folder still exists; a `skip (pending-review …)` row on a run whose console resolved the merge as anything other than `leave-open`.

### 3. The wrap-up report blocks on a surviving folder
- **Action:** `summary-template.md`'s Verdict carve-out lets a lone `worktree-removed` fail read "not applicable — pending this session's own worktree exit" only when its detail is `worktree still listed` (the session simply hasn't exited yet). A `worktree unlisted but directory still present` fail is never carved out — it blocks like any other failing check, and the report names the path.
- **Should feel:** The verdict matches reality — "Everything shipped" never sits above a folder someone still has to delete.
- **Should understand:** The carve-out exists for a real, expected state (the composing session is still inside its own worktree); narrowing it by detail keeps that case quiet without hiding the new one.
- **Red flags:** A report listing a `directory still present` row as "not applicable".

### 4. The release probe reads the CHANGELOG the tag actually shipped with
- **Action:** In a main checkout whose local integration branch lags its remote (the mirror fast-forward skipped as dirty), the residue release probe reads `CHANGELOG.md` from the remote-tracking ref (`resolveRemoteRef` over `--integration-branch`, e.g. `origin/main`) when that ref exists, a local tag qualifies, and the newest such tag is an ancestor of it. Otherwise it reads `HEAD`, today's behavior — including every consuming project with no remote. Behind the remote with the remote CHANGELOG unreadable, it declines: `ran: false`, `local integration branch is behind its remote — CHANGELOG check skipped`.
- **Should feel:** Quiet when upstream is already right — no `remedy: auto` finding that would open a housekeeping change for an entry that already exists.
- **Should understand:** Every finding's evidence names which ref it read (`CHANGELOG.md at origin/main` vs `at HEAD`), so a reader can tell a real gap from a stale-checkout artifact.
- **Red flags:** A `kind: release` finding "tag vX.Y.Z exists … but CHANGELOG.md at HEAD has no version heading" on a checkout that is merely behind its remote.

## Origin
- Created during build of #3023 (post-merge cleanup reports a clean result when the state is not clean)
- Steps 1-4 built in this session
- Updated for #3373 (Step 2's `worktree-removed` fails render a pending-review `skip` when `console.json` records merge resolution `leave-open`)
- Updated for #3695 (Step 1: on Windows, the `prunable` retry and the `--merged` branch lookup now match git's forward-slash porcelain path against the native stamped path)
- Related journeys: `recover-a-teardown-with-no-recorded-worktree.md` (the same `teardown-run` call when no worktree was recorded at all), `verify-wrap-ups-closure-checklist-900.md` (the `verify` checklist this row belongs to), `sweep-only-your-own-residue-at-close-time.md` (the residue sweep the release probe runs inside)
