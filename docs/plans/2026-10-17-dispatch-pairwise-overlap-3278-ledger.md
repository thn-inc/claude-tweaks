# Open Items — dispatch: transitive file-overlap grouping through hub files starves records in oversized groups (#3278)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 10 commits ahead of local main, and local main was 5 commits ahead of origin/main ([reconcile] archive-run renames) (reason-not-auto: requires-judgment — pushing local main's own unpushed commits is the user's call) | accepted | Post-creation catch-up merged origin/main into this worktree branch, so this run builds on the current tip. The 5 local archive commits ride along, as such commits routinely do (29 reached origin/main since 2026-10-10 the same way). |
