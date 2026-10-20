# Open Items — verify.js stamps the HEAD it reads after the checks finish, so a mid-run commit gets a pass it never had

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 24 commits ahead of local main at run start | observation | Post-creation catch-up merged origin/main into the worktree branch (d170e1b4e → 75caf65ce) |
| 2 | ops | #3757 overlaps open #2987 and #3002 on `plugin/bin/verify.js` (both attached to stale PR #3332) | observation | Warning only (flow Step 2.8); built #3757 alone — whoever rescues #3332 rebases over this change |
