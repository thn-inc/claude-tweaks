# Open Items — Background post-merge summary counts a failed-close run as ran

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight: origin/main was 4 commits ahead of local main; the worktree caught up to 1f54ee150 | observation | Worktree caught up at creation; the main checkout's mirror did not fast-forward (dirty) |
| 2 | ops | File overlap with #4798 on `plugin/bin/lib/reconcile/post-merge.js` (draft PR #4947 in flight) and #3977 on `plugin/bin/lib/reconcile/format-summary.js` | observation | Warning only; the split with #4798 is stated in the spec. Expect a text conflict at whichever merges second |
