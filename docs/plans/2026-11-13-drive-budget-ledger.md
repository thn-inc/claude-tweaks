# Open Items — drive.js --budget N: the driver picks its own records

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of local main at flow Step 2.5 | observation | Self-resolved: reconcile fast-forwarded local main to 37c2b02 before worktree creation; post-creation catch-up merges were no-ops |
| 2 | build | SDD ruling — pre-screen only groups rankNext could select (skip oversized/neighbour-in-flight groups): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — final reviewer's 7 declined-to-judge items stand outside this record (spec-, PRC2- or module-mandated): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | Follow-up (out of this record's scope, untouched file): tests/bin-lib/dispatch/queue-pull.test.js:2329 claims rankNext skips "exactly" the non-removing reasons + firing but proves only containment — a reason added straight into rankNext's literal (queue-pull.js:1154) with no PASSES row escapes it; capture as a record at wrap-up | open | — |
