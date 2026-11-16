# Open Items — dispatch: a merged group's worktree can be deleted while the dispatching session is still in it (#4960)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 7 ahead of local main, which also carried 10 unpushed reconcile archive commits | fixed | Merged origin/main into local main and pushed (b1a0f20ef1); worktree branched from the synced tip, catch-up merges no-op |
