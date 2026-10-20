# Open Items — verify.js --cwd into another checkout writes the invoking checkout's pass stamp

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 6 ahead of local main at Step 2.5, and local main carried 2 unpushed sibling [reconcile] archive commits (reason-not-auto: no-cli — sibling sessions own those commits) | observation | By worktree creation local main equaled origin/main (7bc79385e); post-creation catch-up was a no-op, nothing rode along |
| 2 | ops | #3799 overlaps open #2987 (plugin/bin/verify.js), #3002 (plugin/bin/verify.js, plugin/bin/lib/verify/args.js — both attached to stale PR #3332) and #3679 (docs/plugin-structure.md) (reason-not-auto: requires-judgment — whoever rescues #3332 rebases over this change) | observation | Warning only (flow Step 2.8); built #3799 alone as named |
