# Open Items — Review Console leaves debate-settled findings keep-staged (#4563)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence: origin/main was 16 commits ahead of local main; reconcile could not fast-forward the main checkout because a sibling session's untracked `.claude-tweaks/pipelines/2026-10-28T172007-sweep-standalone/` dirties it (reason-not-auto: requires-judgment — the run dir belongs to another session) | acknowledged | This worktree caught up via the post-creation merge (519af9a72); the main-checkout mirror stays behind until that run dir clears, tracked by #4462 |
