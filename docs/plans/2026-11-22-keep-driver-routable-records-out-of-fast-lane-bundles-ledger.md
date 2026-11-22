# Open Items — Keep driver-routable records out of dispatch's fast-lane bundles

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 1 commit ahead of the worktree branch | fixed | Caught up by the post-creation merge commit c97e652673 |
| 2 | build | SDD ruling — T3 discrimination revert-and-restore done by the implementer in its own worktree, not a reviewer: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | Ratified at the auto-resolved console (Defers: no, no record): T3 discrimination revert-and-restore stays with the implementer, the reviewer checks the diff touches only the test file |
| 3 | build | SDD ruling — queue-order cache stamp ignores driver settings, deferred (needs-human-decision): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build/skill | Governing skills checked (shared-contract-extraction, dispatch-queue-exclusion-addition, blocker-surface-parity): no divergence; the build adds a lazy-require pattern for driver modules in a dispatch-path module, already stated in the module comment | observation | observation only; no skill update proposed |
| 5 | ops | Pre-flight branch-divergence check at the test-step handoff: origin/main was 2 commits ahead of the worktree branch | fixed | Caught up by the wrap-up merge commit aafe704b72 (clean merge of origin/main; targeted suites 353/353 pass) |
