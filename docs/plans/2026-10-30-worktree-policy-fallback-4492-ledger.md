# Open Items — policy resolution in worktrees: gitignored policy.yml is invisible (#4492)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 1 commit ahead of the dispatched worktree at Step 2.5 | fixed | Post-creation catch-up merged origin/main into the worktree branch (27193c7b2 → 0bbbfa63d) before any build task |
