# Open Items — dispatch: transitive file-overlap grouping through hub files starves records in oversized groups (#3278)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 10 commits ahead of local main, and local main was 5 commits ahead of origin/main ([reconcile] archive-run renames) (reason-not-auto: requires-judgment — pushing local main's own unpushed commits is the user's call) | accepted | Post-creation catch-up merged origin/main into this worktree branch, so this run builds on the current tip. The 5 local archive commits ride along, as such commits routinely do (29 reached origin/main since 2026-10-10 the same way). |
| 2 | build | Real-input probe (Task 8 Step 1) on the live auto:build queue, 2026-10-17: there are 61 eligible records, and an independent jq count over the same snapshot also gives 61. `buildDispatchGroups` produces 61 groups (largest size 1, 0 fast-lane bundles), and `groups.flat()` holds 61 records. The old `groupByFileOverlap` over the same input has a largest group of 18. | observation | The per-record grouping holds on real data. The chain that starved 18 records is gone. |
| 3 | build | SDD Task 1 minor: grouping.test.js test names start `Review Focus N:` | accepted | Plan-mandated naming that traces each test to the plan's Review Focus line. Cosmetic. |
| 4 | build | SDD Task 1 minor: `buildDispatchGroups` passes its whole options bag to `directOverlaps` (grouping.js) | accepted | Intended. The hub overrides (`hubPathMinCount`/`hubPathFraction`) must reach `directOverlaps`, and unknown keys are ignored. |
| 5 | build | SDD Task 1 minor: `directOverlaps` is quadratic per shared file | accepted | Bounded by the hub threshold, because a file cited by ≥ max(3, 10%) records never links. On the real queue (61 records) it is negligible. |
| 6 | build | SDD Task 2 minor: `composeOrderBlob` doc comment omits the `grouping` stamp | fixed | db1b05232 |
| 7 | build | SDD Task 3 minor: in-flight-neighbours.js does not null-guard `candidates` (it does guard `inFlight`) | accepted | The only caller (queue-pull-script.md) always passes `.flat()` of an array, so a null cannot reach it. |
| 8 | build | SDD Task 3 minor: a `{content: undefined}` read result classifies as absent | accepted | Fails open (not live, so no exclusion), which matches the spec's failure posture. |
| 9 | build | SDD Task 3 minor: no explicit test for a null read result | accepted | The code path is handled. The fail-open behaviour is pinned by the `{failure}` and throwing-reader tests. |
| 10 | build | SDD Task 4 minor: the neighbour-in-flight reason bullet is listed before passes that run earlier | accepted | Plan-mandated placement next to its sibling reason bullets. Reading order only. |
| 11 | build | SDD Task 4 minor: the reworded #1944 comment leaves one long line | accepted | Cosmetic. The comment was further edited in 9ffcf607e. |
| 12 | build | SDD Task 5 minor: next-ranking.md says the neighbour skip applies "for this firing" | fixed | db1b05232 (now "for that queue pull") |
| 13 | build | SDD Task 5 minor: firing-exclusion.md:44 is a long line | accepted | Cosmetic. No rendering or pinning impact. |
| 14 | build | SDD Task 7 minor: plugin-structure.md dispatch row says every design position "was extracted" | fixed | db1b05232 |
| 15 | build | SDD Task 7 minor: journey #2775 title says "Dispatched File-Overlap Group" | fixed | db1b05232 (title only; filename kept so citations hold) |
| 16 | build | Final review I1: the neighbour guard turns off silently when the `bot:in-progress` fetch fails; no mcp-transport.md entry | fixed | 9ffcf607e. The failure now prints an AUTO line, a cap warning fires at 200, and the MCP gap is documented with a re-open condition. |
| 17 | build | Final review I2: `/flow` claim-targets File-overlap note used transitive `overlapGroups` and falsely said dispatch shares the primitive | fixed | ad8c1ffcc. Adds a `directOverlaps` envelope field (additive), and the note reads it and is skipped on dispatched runs. |
| 18 | build | Final review M1–M3: Step 2 heading, `bundleFastLaneSingletons` doc comment, #1944 volume note | fixed | 372355fa1, 9ffcf607e |
| 19 | build | Final review, declined to judge: an orphaned but unexpired claim (ttl 72h) now holds its direct neighbours out of bare drain, not just itself | observation | This follows the spec's decision ("waits while a direct neighbour holds a live claim"). Stale-claim reclamation belongs to /tidy. Watch for neighbour starvation in practice. |
