# Open Items — #3854 verify report.js git calls omit windowsHide

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead at pre-flight | observation | Caught up — worktree branch includes origin/main (0ac46ab14); it also carries one local-only ride-along `[reconcile] archive run` commit (5a4293816) from local main |
| 2 | ops | #3854 file-overlaps open #2987 on plugin/bin/lib/verify/report.js | observation | Warning only (Step 2.8) — built #3854 alone as named; #2987 touches the pass-stamp path, not the git-call options |
