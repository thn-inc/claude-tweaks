# Open Items — hooks.js: an unexpected exception in a VERBS command exits 0 via the entry catch (#4932)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 2 commits ahead of local main at run start (2defc6d05, d8aa7716b). | fixed | Local main and origin/main were both at 7ab86605b by worktree creation; the worktree branched from it, and the post-creation catch-up merges were no-ops |
