# Open Items — Merge mode's MERGED-PR next step may dead-end: does cleanup-only resolve an archived run? (#4692)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — T2's test title becomes "a non-clean Step 4.0 prints closingLinks and the record lists": ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — Task 1 re-review minor (path.resolve throws on a non-string runDir) is closed by Task 2's CLI, which rejects a missing/empty --run with exit 2 before calling postMergeOne and passes the resolveTarget-anchored real path: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — the re-run next step (user decision) applies to marker-less skipped failures only (transient-failure, network-failure, claim-failed, marker-write-failed, error, gh-absent, CLI exit 2/3); a ran-shaped failure (step40Failed, or closingLinks reopen-failed/close-failed/close-pending/base-unchecked) already wrote the marker, so its line cites Step 4.0's per-list hand actions and tidy's parent-gate backstop instead: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — no-pr, no-pr-states and not-merged join the no-next-step group: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — pr-not-found, invalid-arguments and no-pr-state join the no-next-step group, and post-merge-run.js header comment lists them too: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — Task 4 minors 1 and 3 need no change: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build | SDD ruling — an archived run's in-flight line names the holder as another merge invocation and, since no reconcile pass walks archive/, names a re-run after the claim's stale window (CLAIM_STALE_MS) for a dead holder; a live run's in-flight line keeps naming no next step: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 8 | build | SDD ruling — gh-absent moves out of the re-run group to "re-run where gh is available" plus tidy's parent-gate backstop: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 9 | build | SDD ruling — the 4 residual minors are fixed by the controller in one commit (0b39deb) rather than parked: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
| 10 | review | Review (high, Test quality): win32-fragile runDir expectation in post-merge.test.js setup-failures test — staged/review-1.patch (staged/review-1.patch) | open | — |
