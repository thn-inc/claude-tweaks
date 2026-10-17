# Open Items — #3036: flow Step 1.8 creates the open-items ledger before the run's worktree exists

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 38 commits ahead of local main at /flow Step 2.5 | fixed | Worktree branch caught up with origin/main at creation (post-creation catch-up, HEAD 12bd85599) |
| 2 | ops | Ledger created after worktree creation rather than at /flow Step 1.8 — the installed 6.140.0 Step 1.8 cannot write docs/plans/ from the main checkout under worktree-always (the defect this record fixes) | observation | Deliberate per this record's own Deliverable 1 ordering; logged to decisions.md |
