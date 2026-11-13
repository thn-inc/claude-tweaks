# Open Items — Cut the test suite's process churn from fixture git repos

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch divergence: origin/main was 5 commits ahead of local main, which also carried 4 unpushed reconcile archive commits (reason-not-auto: requires-judgment) | accepted | Worktree branched from origin/main 7a2152c9c, so this branch has every upstream commit and none of local main's unrelated archive commits; nothing left to reconcile for this run. |
