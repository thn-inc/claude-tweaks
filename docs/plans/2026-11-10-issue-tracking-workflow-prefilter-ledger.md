# Open Items — issue-branch-tracking.js: the generated track-issue-fixes workflow starts a runner on every push to every branch

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch divergence: local main 12 behind origin/main and 1 unpushed [reconcile] archive commit (8946fd39a) ahead | observation | Worktree branch reset to origin/main c1fa86602 before any work, so neither direction affects this run; syncing local main (and pushing its archive commit) is left to the user |
| 2 | build | SDD ruling — long-s stems added to the prefilter, JS model folds ASCII only: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | ops | CI/CD change: .github/workflows/track-issue-fixes.yml regenerated (job-level prefilter on commit messages, claims-registry/health-state excluded at the trigger) — review the workflow diff before merge (reason-not-auto: requires-signoff) | open | — |
