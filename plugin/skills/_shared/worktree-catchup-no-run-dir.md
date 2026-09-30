# Worktree Catch-up Log — No Run Directory

Referenced by `_shared/worktree-setup.md`'s Post-creation catch-up ("Log the correction when it
changes anything") — read only when that catch-up's merge advanced the branch and no pipeline run
directory resolves (`_shared/run-dir-resolution.md`'s Resolution order steps 1-4 all miss).

## Who reaches the catch-up with no run directory

- An interactive session entering a worktree because the SessionStart `worktree-always`
  instruction pointed it at the catch-up (`bin/lib/hooks/session-start.js`, and the gate's own
  deny message in `bin/lib/hooks/pre-tool-use.js`) — which covers every `/claude-tweaks:specify`
  entry path (shaping, decomposition, the `needs:definition` brainstorming redirect), since none
  of them creates a run directory before the session is isolated.
- `/claude-tweaks:init`, and any other `_shared/scratch-worktree.md` Section 3 caller running
  without a run directory.
- `/claude-tweaks:routine`'s create-and-update Step 0.

## Where the advance line goes

Report the same advance line the run-dir path would log — `Post-creation catch-up: worktree
branch advanced from {before short} to {after short} ({N} commit(s) from {ref})` — in the caller's
own user-facing output: the next reply to the user, and the skill's completion summary or Next
Actions block when it renders one. Never defer it to a run directory that may never exist. This is
`_shared/auto-decision-log.md`'s No-run-dir carrier convention applied to this entry.

If a run directory does resolve later in the same session, also append the entry to that run's
`decisions.md` under the resolving skill's own heading at that point. A no-op merge (branch tip
unchanged) still writes and reports nothing.

## Why not a standalone log file

The `worktree-always` gate exempts only `.claude-tweaks/pipelines/` and
`.claude-tweaks/policy.yml`, so the very worktree session running this catch-up cannot create a
new log file elsewhere under `.claude-tweaks/`. Minting a run directory just to hold one line
leaves reconcile residue.
