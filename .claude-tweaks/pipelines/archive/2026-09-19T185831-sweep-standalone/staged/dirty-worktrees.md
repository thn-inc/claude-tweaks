# Staged: manual review — 6 dirty worktrees

Finding: `[git]` Step 4.5 scan — the following worktrees carry uncommitted changes and were never
Remove/delete-eligible per `scan-procedures.md`'s Dirty-worktree override (never auto-applied,
never `--force`):

- `.claude/worktrees/agent-a97b6fa2589f7ca3f`
- `.claude/worktrees/dispatch-record-1337`
- `.claude/worktrees/dispatch-record-1725`
- `.claude/worktrees/dispatch-record-457`
- `.claude/worktrees/record-1471`
- `.claude/worktrees/record-1686-1733-1734-1737-1738-2225`

Recommended next step: a human inspects each worktree's uncommitted changes (`git -C {path}
status --porcelain`) and decides commit/discard/keep — none of these are mechanically safe to
touch here.
