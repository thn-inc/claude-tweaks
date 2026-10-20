# Open Items — first-call-artifact-check.js does not verify the canonical Step 2.8 claim line the dispatcher's own gate depends on

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — repair branch (missing-config, repairable:true) returns before the new claim-log check, kept out of scope: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | Whitespace typo `const pass =checkFirstCallArtifacts(` in the AC6.2 pass block of tests/bin-lib/dispatch/first-call-artifact-check.test.js | resolved | Fixed in the build's follow-up commit (fix-now: introduced by this diff, one character) |
| 3 | build | two-call-gate.md sentence calls the canonical line "the line the stamps gate in pre-tool-use.js needs", but that gate reads the lenient hasClaimLogFor — reword to "the canonical line verify-run-bookends.js enforces" | resolved | Reworded in the build's follow-up commit (fix-now: introduced by this diff) |
