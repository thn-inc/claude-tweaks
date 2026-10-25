# Open Items — Inline component skills that end on an "Output ONLY these lines" render stall the calling pipeline (#4117)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Task 1: sweep predicate collapses whitespace but placementOk matches RETURN_LINE exactly — slight inconsistency, harmless (roster files caught either way) | deferred | |
| 2 | build | Task 1: placementOk does not pin that RETURN_LINE is alone in its paragraph | deferred | |
| 3 | build | Task 1: ROSTER is hand-kept; a new bare-render mode without the literal Output ONLY is not caught automatically | deferred | |
| 4 | build | Task 2: doc pin sentence names only the Output ONLY sweep, not the ROSTER that also covers merge-check/failure-check (plan-mandated wording) | deferred | |
| 5 | build | Task 2: doc placement fact checks the phrase, not that the fence follows it | deferred | |
| 6 | build | Task 2: commit body check — see git log for refs placement | deferred | |
| 7 | build | Final review: outputSection's heading-count!=1 throw branch has no dedicated test (fails safe as offender) | deferred | |
| 8 | build | SDD ruling — fix the design-wrapper Output to caller gap in the final-review fix wave rather than defer: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
| 9 | build | SDD ruling — fix-wave implementer runs on sonnet (Standard), not the size:low Fast default: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | |
