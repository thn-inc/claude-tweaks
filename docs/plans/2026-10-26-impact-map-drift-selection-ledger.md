# Open Items — Select tests changed between the map's commit and the base, so map-to-base drift cannot deselect a test

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | verify.js:625 map-unlocatable stub lacks driftTests (Task 2 plan already adds it) | deferred | Resolved in 1802fe97c (stub carries `driftTests: []`) |
| 2 | build | No dedicated test for a drift entry in headTests but absent from the map (covered indirectly via new.test.js landing in untracedTests) | deferred | Final review: covered directly (new.test.js in the drift input asserted absent from driftTests) |
| 3 | build | impact-selection.md drift paragraph says "Only map-not-ancestor ... stops it" though any map problem skips the drift read | deferred | Resolved in 5c84c3121 (final-review fix wave) |
| 4 | build | scope.js header comment rewrap leaves one overlong line | deferred | Resolved in 5c84c3121 (final-review fix wave) |
| 5 | build | stdout `Impact:` line does not show the drift count (not asked by the spec) | deferred | |
| 6 | build | SDD ruling — final-review Minor 4 (impact.js repeats parseNameOnlyZ split / glob recompile one-liners): left as is, mirroring listHeadTests; cost if wrong: trivial follow-up: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
