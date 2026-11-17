# Open Items — Move the per-fixture template tests out of helpers-git-template.test.js (#5846)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight divergence: origin/main (c3eaa6ded9) was 19 commits ahead of the main checkout's local main, which also holds 5 unpushed reconcile archive commits. | observation | The worktree branch was based on origin/main c3eaa6ded9, so the PR holds only this record's commits; syncing local main is the user's call. |
| 2 | ops | Step 2.8 file-overlap warning: 20 open unclaimed records share a key file with #5846 (#5033, #5077, #5193, #5212, #5327, #5378, #5400, #5479, #5494, #5496, #5497, #5545, #5546, #5651, #5653, #5655, #5661, #5663, #5759, #5858). | observation | Warning only; this run builds #5846 alone. Whichever of them builds later meets a moved test in its destination file. |
