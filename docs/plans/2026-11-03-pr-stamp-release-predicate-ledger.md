# Open Items — Extract the PR-stamp release rule so the push gate and phase-exit.js call one predicate

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | flow Step 2.5: origin/main was 21 commits ahead of the adopted branch at pre-flight | fixed | Caught up by merge commit f41d32728 (Common Step 1 post-adopt catch-up) |
| 2 | ops | flow Step 2.6 shape signal: plan Task 1 declares 6 files (> 5) | accepted | One cohesive change: the two code files that share the predicate, the two docs that describe it, and its two test files; auto mode proceeded per validation.md 2.6 |
