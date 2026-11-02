# Open Items — claim-targets: a permission-denied claim read or write exits 4 as a transient retry

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 12 ahead of the main checkout (reconcile mirror not fast-forwarded: dirty). The worktree caught up with origin/main at creation. (reason-not-auto: requires-human-judgment) | observation | The main checkout's dirty state belongs to the user; this run did not touch it. |
| 2 | ops | Step 2.8 overlap warning: 24 open records share a file with #4899; the closest is #4265 (claim-targets.js). (reason-not-auto: requires-human-judgment) | observation | Warning only; whichever lands second may need a rebase. |
| 3 | build | SDD ruling — reason strips the gh command line in claim-targets.js: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — dispatch teardown skips the claim release on this stop: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | build | The gh-absent MCP claim path, a refused post-write read-back, and an unconfirmed write left unreleased (the user's plan-review decision and final-review findings) | deferred | Defer-reason: needs-human-decision. Staged as a follow-up record: staged/leftover-1.md. |
| 6 | build | The exit-6 bootstrap reason may carry the gh command line (claim-targets.js bootstrap path); the spec keeps bootstrap unchanged | deferred | Defer-reason: pre-existing-outside-diff. No claim payload reaches it, and it stays as the spec requires. |
