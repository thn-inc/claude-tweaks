# Staged: manual review — 4 unmerged worktrees/branches

Finding: `[git]` Step 4.5 scan — worktrees `record-1752`, `record-1796`, `record-1798`, `record-1800`
were reported "clean, in reaper domain" by the scan agent, but independent verification before
any deletion found none of their branches (`worktree-record-1752`, `worktree-record-1796`,
`worktree-record-1798`, `worktree-record-1800`) are merged into `main` or `origin/main`, and none
are net-empty against their own fork point (non-zero diff). Per `scan-procedures.md`'s Step 4.5
classification table, this is the "unmerged — manual review required" outcome, not a safe delete.

A fifth worktree in the same batch, `record-1676`, had its checkout already removed before this
was discovered (its branch `worktree-record-1676` is likewise unmerged/non-net-empty and was left
intact — nothing was lost, only the working-directory checkout).

Recommended next step: a human (or a `/claude-tweaks:tidy --scope=git` run with someone present)
inspects each branch's actual diff and decides keep/merge/discard — these are not mechanically
safe to auto-delete.

Commands to inspect each:
```
git log --oneline main..worktree-record-1752
git log --oneline main..worktree-record-1796
git log --oneline main..worktree-record-1798
git log --oneline main..worktree-record-1800
git log --oneline main..worktree-record-1676
```
