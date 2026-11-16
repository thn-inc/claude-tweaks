# Open Items — Compose procedure bundles for review lens and SDD children (#4359)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — keep procedureFileKey first-skills/-segment anchor (Task 1): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — fold efficiency-report docs update into Task 5 (Task 4): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — targeted fix for the readFileKey order residual (final review): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — no change for rg --files dir treated as pattern (T1-3): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — no change for the unrounded reviewFileReads median (T4-1): ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | Task 5 observation: a non-object buildTiming result throws outside the per-run catch (loud, pinned by a test); the default efficiency report now loads phase-timing.js at startup (deliberate trade for loud failure) | observation | Parked by SDD after the Task 5 re-review; no action needed |
| 7 | build | isProcedurePath's (^\|/)(plugin/)?skills/.+md rule (#1929) counts procedureBytes and the procedure turn class for any .md under a skills/ ancestor, so a composed-bundle read from a checkout under skills/ still adds procedureBytes; changing it moves shipped numbers and needs characterization tests (plugin/bin/lib/timing/turn-class.js isProcedurePath; transcript.js:181,208) | open | Defer-reason: pre-existing-outside-diff — the rule predates this branch; the per-file key this record needs is already correct (5f4bc4494) |
