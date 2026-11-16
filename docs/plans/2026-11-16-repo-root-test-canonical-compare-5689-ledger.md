# Open Items — Windows regression: 1 test file(s) newly failing after b3517f660 (#5689)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight divergence: origin/main was 8 commits ahead of the main checkout's HEAD, which also carried 9 unpushed commits | fixed | The run's worktree was created on origin/main at 4e093f5c2, so the branch is level with origin and carries none of the local-only commits |
