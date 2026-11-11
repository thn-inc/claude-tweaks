# Open Items — pr-first-merge Step 2.5: checks are read right after gh pr ready, so a project whose CI skips draft PRs is read green and merged unverified

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch divergence: the main checkout's local main is 13 behind origin/main and carries 1 unpushed [reconcile] archive commit (8946fd39a) | observation | Worktree branch pointed at origin/main 18c73c625 before any commit, so neither direction affects this run; syncing local main is left to the user |
