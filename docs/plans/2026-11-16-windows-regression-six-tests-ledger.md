# Open Items — Windows regression: six test files failing on main with no record (#5694)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 2 commits ahead of the worktree branch | fixed | Caught up by the adopt-path merge of origin/main, commit 5d83314361 |
| 2 | build | SDD ruling — Tasks 1, 3, 4 and 5 ran as one batch (one implementer, one review): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build/skill | windows-checkout-test-parity extends: git apply writes through core.autocrlf even outside a repository, so a printed or tested git apply needs -c core.autocrlf=false, and a test can reproduce the Windows default on any host with GIT_CONFIG_GLOBAL autocrlf=true plus GIT_CONFIG_NOSYSTEM=1 | observation | — |
