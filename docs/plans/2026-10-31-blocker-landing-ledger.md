# Open Items — flow: a closed blocker is treated as satisfied even when its merge never reached the integration branch (#4553)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of the dispatched worktree's HEAD at Step 2.5 (reason-not-auto: n/a — resolved in-run by Common Step 1's Post-creation catch-up merge) | fixed | Worktree fast-forwarded 302f0cb → ab2f509 by `git merge origin/main` before the materialize commit |
