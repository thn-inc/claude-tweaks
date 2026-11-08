# Open Items — Cut redundant local full-suite runs in pipelines — affected-set per task, no worktree baseline run

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence: origin/main was 946 commits ahead of the main checkout local main (reconcile mirror-ff refused: dirty main checkout); worktree caught up by post-creation merge (be11935 to 502b532) | observation | Informational — worktree is current with origin/main; main checkout's local main remains stale until its dirty files are resolved (reason-not-auto: requires-human-judgment) |
