# Open Items — Cut remote-protocol git work in the prune-remote, pre-review-catchup and claims-git-cas test fixtures

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead at run start; caught up by the post-creation merge | observation | Informational: merged origin/main into the worktree branch before building |
| 2 | ops | Pre-flight branch-divergence-check on resume run 2026-11-16T183940: origin/main was 5 commits ahead; caught up by the adopt-path merge (reason-not-auto: informational only, already resolved by the catch-up merge) | observation | Informational: merged origin/main into the worktree branch (35c97a6b6e) before building |
