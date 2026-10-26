# Open Items — Record a test-impact map's dirty-tree provenance and clean up an interrupted trace's temp dir

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | impact-selection.md: the dirty paragraph sits between the map shape sentence and the paths description (readability) | deferred | Task 1 review minor; final review triage: leave — reads correctly |
| 2 | build | A second-signal SIGKILL of tools/run-tests.js skips its cleanup (slot lock, run root) — plan-mandated tradeoff; relies on run-tests.js's dead-pid slot recovery and orphaned run-root sweep | deferred | Task 2 review minor; final review triage: leave — run-tests.js recovers on its next run |
| 3 | build | `trace --allow-dirty` now always runs git status, so a failing status exits 1 where it used to proceed; the header's exit-code notes don't name the case | deferred | Task 3 review minor; final review triage: leave — header's exit 1 already covers "gh/git failure" |
| 4 | build | The e2e `dirty === false` assertion in tests/test-impact-cli.test.js overlaps the `stderr === ''` assertion (redundant guard) | deferred | Task 3 review minor; final review triage: leave — field vs warning are distinct checks |
| 5 | build | SDD ruling — fold SIGHUP into trace's signal handling (forward to the suite, exit 129) beyond the spec's SIGINT/SIGTERM: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 6 | build | SDD ruling — install trace's signal handlers before mkdtempSync with a child-null guard: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 7 | build | SDD ruling — leave the journey doc update to Common Step 6, not the final fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 8 | build | SDD ruling — leave four cosmetic final-review minors (ledger rows 1-4) as-is per the final reviewer's triage: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
