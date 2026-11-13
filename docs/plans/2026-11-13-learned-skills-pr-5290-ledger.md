# Open Items — Wrap-up's learned-skill edits block the run's own auto-merge at merge-check's instruction-file floor (#5290)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence: origin/main was 5 commits ahead of local main at run start, and local main carries 4 unpushed [reconcile] archive commits that ride along into this branch (reason-not-auto: requires-judgment) | observation | Worktree caught up with origin/main after creation; ride-along commits are pure run-dir archive renames, expected for a human-present run |
