# Open Items — Close below-floor parents when an armed PR merges after its session ended

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 10 commits ahead of the adopted branch | fixed | Caught up by Common Step 1's post-creation merge (40cdd15bb) |
| 2 | build | SDD ruling — R1: post-merge subtracts closedAfterWindow from the closing set: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — R2: null integration branch skips post-merge without a marker, not deferred: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — R3: atomic rename-based stale-claim takeover: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — R4: tidy-approval vs post-merge double-comment race accepted as residual risk: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — R5: only retryable post-merge skips defer archive; pr-not-found stays visible: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — R6: marker-write failure documented as nothing re-closes: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | SDD ruling — R7: below-floor close comment copy classified copy-only in the accept-label guard: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 9 | build | SDD ruling — R8: Step 4.0b summary line only when the closing set was evaluated: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 10 | build/skill | prose-code-twin-pin covers closed vocabularies only; this build added a behavior twin, below-floor-parent-close.js mirroring prose Step 4.0b, pinned by below-floor-parent-close-conformance.test.js (comment template + entry conditions), an enrichment the skill could name | observation | — |
| 11 | build | SDD ruling — R9: the late run closes a non-default-base merge's Fixes records, however late: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
