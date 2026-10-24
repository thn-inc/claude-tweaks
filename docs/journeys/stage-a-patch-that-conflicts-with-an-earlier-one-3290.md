---
files:
  - plugin/bin/check-staged-stack.js
  - plugin/bin/lib/staged-patch/stack-check.js
  - plugin/skills/_shared/staged-patch.md
  - plugin/bin/lib/console/resolve.js
  - plugin/bin/console-resolve.js
  - plugin/skills/review/step3-routing.md
---

# Stage a Patch That Conflicts With an Earlier One

**Persona:** The agent running `/claude-tweaks:review` Step 3 routing (or `/test`'s fix staging or `/deepen`'s collapse staging) partway through a `/flow` run that has already staged one or more `.patch` proposals. It is about to stage another, its diff anchored on lines an earlier staged patch also touches. A second persona: the maintainer who reads `decisions.md` and opens the Review Console hours later.
**Goal:** Learn at staging time — not at the console — that the new patch will not apply on top of the run's earlier staged patches, and either re-derive it onto them or log both patch names, so the console's fast path still applies every patch it can.
**Entry point:** A staging site writes `staged/{slug}-{n}.patch`, and its solo `git -C "$WORKTREE" apply --check "$STAGE_PATH"` exits 0.
**Success state:** Either a `STAGED` line naming the clean patch (unchanged from before), or one naming it with ` Re-derived onto staged/{earlier}.patch.`, or a conflict line naming both `staged/` paths. At the console, every patch that applies at its apply-order position resolves `apply`, including a re-derived one that would fail alone.

## Steps

### 1. Run the stacked check after the solo check passes
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/check-staged-stack.js" --worktree "$WORKTREE" --patch "$STAGE_PATH" --rederive-out "{session tmp}/rederive-{slug}-{n}.patch"`
- **Action:** The staging site follows `_shared/staged-patch.md`'s Staging-time gate past the solo check into its Stacked check. The CLI copies every file the run's patches touch into a throwaway scratch repo and applies `staged/*.patch` in apply order (byte-wise filename sort, `review-1` < `review-10` < `review-2`).
- **Should feel:** Invisible when nothing conflicts — exit 0, one JSON line, nothing on stderr, and the site writes exactly the `STAGED` line it always wrote.
- **Should understand:** The check never touches the worktree or `staged/`; the only write is `--rederive-out`, which may not point inside `staged/`. It runs with user and system git config switched off, so a `diff.noprefix` setting cannot change its verdict — on Windows too, where the global config is pointed at `/dev/null` because Git for Windows rejects the native null device (`\\.\nul`).
- **Red flags:** A `STAGED` line written straight after the solo check with no stacked check run. Extra log lines on a clean stack. Any modified file in `git status` after the check. On Windows, a single clean patch reported as not applicable (exit 2, every patch in `skipped`) — git refused the config path before it read a patch (#3696).

### 2. Read a conflict naming both patches
- **URL:** the CLI's exit 1, its stderr line, and its JSON `targetConflict`
- **Action:** Read `check-staged-stack.js: staged/{patch} does not apply on top of staged/{conflictsWith} in apply order ({error})`. The new patch may be either side: a new `review-10.patch` sorts before an existing `review-2.patch`, so the existing one can be the one that fails. When more than one conflict involves `--patch`, the same line carries each one, joined by `; `.
- **Should feel:** Specific. Two file names and git's own error, not "a patch conflicted".
- **Should understand:** A patch that does not apply even alone is the solo gate's business (exit 2 here), never reported as a conflict. Exit 4 means the check could not run, never "clean".
- **Red flags:** A conflict line naming only one patch. A line that drops a second conflict involving `--patch`, or that names a pair which does not involve `--patch` at all. Exit 0 when `--patch` was never among the walked names.

### 3. Re-derive, re-anchor, or log
- **URL:** the JSON `rederived` / `rederiveReason` fields, and the run's `decisions.md`
- **Action:** When `rederived` is set, overwrite `staged/{slug}-{n}.patch` with that file (its `Target:`/`Invariant:` preamble kept verbatim), re-run only the stacked check, once, and write the `STAGED` line suffixed ` Re-derived onto staged/{earlier}.patch.` When it is null, re-anchor once if the edit admits another anchor, or keep the patch and log the `stacked check: staged/{a} does not apply on top of staged/{b}` line.
- **Should feel:** Decided, not stalled — none of these branches stops an `auto` run.
- **Should understand:** Re-derivation is a 3-way `git merge-file` onto the stacked state, verified to apply there before it is returned. Two insertions at the same anchor always conflict in a 3-way merge, so the motivating case (run 2026-10-16T181217-spec-2882) ends in the logged conflict or a manual re-anchor, never a silent guess. A patch with a mode change, rename, create, or delete is never re-derived.
- **Red flags:** A re-derived patch written without its preamble. A re-derive attempted when the target was the earlier side. A second re-derive after the re-run.

### 4. See the console apply the stack
- **URL:** the Review Console (`/claude-tweaks:wrap-up` Phase 4; `console-resolve.js` under `consoleAutoResolve`)
- **Action:** **The maintainer** (or the unattended resolver) reads each staged patch's verdict. `readSnapshot` judges the run's patches with one stacked walk in apply order, so a re-derived patch resolves `apply` and the console applies the patches in that same order.
- **Should feel:** Like the staging-time verdict and the console agree, because they apply one order.
- **Should understand:** If the maintainer declines the earlier patch, the re-derived one no longer fits and takes the console's stale path (re-derive from `Invariant:`). Expected, not a failure.
- **Red flags:** A re-derived patch reported `stale — git apply --check failed` at the console. A logged conflict pair both resolving `apply`.

## Origin
- Created during build of #3290 (check same-run staged patches stacked, not only alone, at staging time), run `2026-10-19T205809-record-3290`.
- Related: `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md` (the unattended console now takes the stacked verdict).
- Updated during build of #3696 (Windows: the stack check's git calls failed on the `\\.\nul` config path, so every staged patch read as not applicable), run `2026-10-20T124821-spec-3599-3602-3695-3696-3698-3699-3595`.
- Updated during build of #3679 (harden and cover the stacked check: the exit-1 stderr line names every conflict that involves `--patch`), run `2026-10-21T225455-record-3679`.
