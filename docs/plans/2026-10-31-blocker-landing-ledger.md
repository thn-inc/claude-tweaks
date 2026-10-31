# Open Items — flow: a closed blocker is treated as satisfied even when its merge never reached the integration branch (#4553)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of the dispatched worktree's HEAD at Step 2.5 (reason-not-auto: n/a — resolved in-run by Common Step 1's Post-creation catch-up merge) | fixed | Worktree fast-forwarded 302f0cb → ab2f509 by `git merge origin/main` before the materialize commit |
| 2 | ops | Pre-flight branch-divergence-check (run 2026-10-31T164258): origin/main was 14 commits ahead of the resumed worktree's HEAD at Step 2.5 (reason-not-auto: n/a — resolved in-run by Common Step 1's Post-creation catch-up merge) | fixed | Worktree advanced 689c3fa10 → 3438ced28 by `git merge origin/main` (merge commit) before any build task |
| 3 | ops | Pre-flight shape check (run 2026-10-31T164258): plan Task 3 declares 7 files, over the 5-files-per-task signal; auto proceeded with tangled-task risk accepted (reason-not-auto: n/a — auto-mode policy choice) | open | |
