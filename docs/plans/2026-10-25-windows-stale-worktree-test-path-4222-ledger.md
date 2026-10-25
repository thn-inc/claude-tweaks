# Open Items — Windows: #3064 stale-worktree test expects a native path where git prints forward slashes (#4222)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow | Step 2.5 pre-flight: origin/main was 3+ commits ahead of local main (release 6.154.0 and its changelog, #4067, then #4032), and local main carried one local-only reconcile archival commit | fixed | Post-creation catch-up merged origin/main 853e54f95 into the worktree branch (4a9cadc22) before any build commit; the archival commit rides along as expected under worktree.baseRef head |
