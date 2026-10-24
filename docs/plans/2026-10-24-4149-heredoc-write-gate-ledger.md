# Open Items — #4149 worktree-always write gate misses writes inside heredocs (#3989 regression)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Step 2.5 pre-flight divergence: origin/main was 4 commits ahead of local main, and local main carried one run-dir-only `[reconcile]` commit (49302ee0a) not on origin (reason-not-auto: informational — no action outstanding) | observation | Worktree created directly at origin/main 7070c0b8a, so nothing was behind and the local-only commit did not ride along; catch-up merge was a no-op. |
