# Open Items — Select tests changed between the map's commit and the base, so map-to-base drift cannot deselect a test

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | verify.js:625 map-unlocatable stub lacks driftTests (Task 2 plan already adds it) | fixed | Resolved in 1802fe97c (stub carries `driftTests: []`) |
| 2 | build | No dedicated test for a drift entry in headTests but absent from the map (covered indirectly via new.test.js landing in untracedTests) | fixed | Final review: covered directly (new.test.js in the drift input asserted absent from driftTests) — tests/bin-lib/verify/impact.test.js, c0252f042 |
| 3 | build | impact-selection.md drift paragraph says "Only map-not-ancestor ... stops it" though any map problem skips the drift read | fixed | Resolved in 5c84c3121 (final-review fix wave) |
| 4 | build | scope.js header comment rewrap leaves one overlong line | fixed | Resolved in 5c84c3121 (final-review fix wave) |
| 5 | build | stdout `Impact:` line does not show the drift count (not asked by the spec) | fixed | Fixed at wrap-up Phase 3: the line ends `, N drift` when any drift test ran — 13912e741 |
| 6 | build | SDD ruling — final-review Minor 4 (impact.js repeats parseNameOnlyZ split / glob recompile one-liners): left as is, mirroring listHeadTests; cost if wrong: trivial follow-up: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
| 7 | wrap-up | pr — PR #4386 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | |
| 8 | wrap-up | residue suite probe not run — skipped via --no-suite; this run's suite state is the runner stamp (scoped, verifiedHead true at ebfa6b95f) and the post-fix re-verify below | observation | |
