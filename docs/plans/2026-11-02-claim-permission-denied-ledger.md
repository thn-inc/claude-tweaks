# Open Items — claim-targets: a permission-denied claim read or write exits 4 as a transient retry

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 12 ahead of the main checkout (reconcile mirror not fast-forwarded: dirty). The worktree caught up with origin/main at creation. (reason-not-auto: requires-human-judgment) | observation | The main checkout's dirty state belongs to the user; this run did not touch it. |
| 2 | ops | Step 2.8 overlap warning: 24 open records share a file with #4899; the closest is #4265 (claim-targets.js). (reason-not-auto: requires-human-judgment) | observation | Warning only; whichever lands second may need a rebase. |
