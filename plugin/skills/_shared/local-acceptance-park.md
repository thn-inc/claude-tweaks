# Local Acceptance Park — `_shared/pr-first-merge.md` Step 2.9

Under control mode a record whose acceptance target resolves `local` is not merged: its PR stays open, `accept:pending` goes on it, and a human accepts it later with `/claude-tweaks:accept`. The CLI (`bin/accept-park.js`) owns every decision and write; this file orders the calls. Read it only when Step 2.9's `parked` exits 0 or 6, or `decide` prints `park:true`.

1. **Already parked.** For each `Fixes` record: `node "${CLAUDE_PLUGIN_ROOT}/bin/accept-park.js" parked --record {n} --run "$PIPELINE_RUN_DIR"` (omit `--run` when the caller has no run dir; the CLI then reads the repo-root policy). Exit 0 or 6 (`unknown`) — never run Step 3; report `pending-review` / `awaiting-local-acceptance` with the PR URL. Exit 5 continues.
2. **Decide.** `node "${CLAUDE_PLUGIN_ROOT}/bin/accept-park.js" decide --run "$PIPELINE_RUN_DIR" --record {n}[,{m}…]` (every `Fixes` record). Control mode off prints `consulted:false` and nothing changes: run Step 3. `park:false` — run Step 3. A multi-spec series decides per record and its shared PR parks when any record parks; the other specs have already completed their own phases.
3. **Park.** `park:true`:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/accept-park.js" park --run "$PIPELINE_RUN_DIR" --record {every record whose decision parks} --claimed {every record of the run} --pr {pr} --head {headRefOid} --worktree {path} --worktree-mode {remove|caller}
   ```

   `--worktree-mode caller` when this session stands in that worktree, then `ExitWorktree` with `remove` as the last act. A non-zero `park` exit: report `pending-review` / `park-failed`, never run Step 3. Exit 0: report `pending-review` / `awaiting-local-acceptance` with the PR URL, never run Step 3.
4. **The park is the run's LAST act.** `park` archives the run dir and removes the worktree, so nothing writes `$PIPELINE_RUN_DIR` after it returns: report and end. Any `steps` entry with `ok:false` in park's JSON (step 3 is refused on an unresolved console or console residue — the run then stays closed-not-archived until reconcile archives it) goes in the run's final report, never swallowed.

A parked record keeps `auto:build`; dispatch's `open-pr` queue exclusion keeps it out of the next pull. A park ends the run at `pending-review`; `/claude-tweaks:accept` re-enters it later (`accept/SKILL.md`'s `awaiting-local` row).
