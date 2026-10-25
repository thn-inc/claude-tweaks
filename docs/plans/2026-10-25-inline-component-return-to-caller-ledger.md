# Open Items — Inline component skills that end on an "Output ONLY these lines" render stall the calling pipeline (#4117)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Task 1: sweep predicate collapses whitespace but placementOk matches RETURN_LINE exactly — slight inconsistency, harmless (roster files caught either way) | fixed | Sweep and both placement predicates now share one own-line matcher (c79638ddd); same-run correction of the build-time `deferred` triage, which staged no proposal |
| 2 | build | Task 1: placementOk does not pin that RETURN_LINE is alone in its paragraph | fixed | The shared own-line matcher rejects a wrapped or inlined copy; new test goes red against the old predicates (c79638ddd) |
| 3 | build | Task 1: ROSTER is hand-kept; a new bare-render mode without the literal Output ONLY is not caught automatically | accepted | merge-check.md and failure-check.md carry no derivable trigger phrase, so no sweep can find sites like them; the roster is the mechanism and fails when a named file is renamed or loses the line. skill-authoring.md states the roster is hand-kept |
| 4 | build | Task 2: doc pin sentence names only the Output ONLY sweep, not the ROSTER that also covers merge-check/failure-check (plan-mandated wording) | fixed | The doc paragraph now names the roster and the `## Output to caller` shape (2dee23374) |
| 5 | build | Task 2: doc placement fact checks the phrase, not that the fence follows it | accepted | A prose-doc pin is phrase-level by design; the behaviour-bearing placement (line after the render fence) is pinned on the shipped files by placementOk and outputSectionOk |
| 6 | build | Task 2: commit body check — see git log for refs placement | accepted | Commit 0807188f6 carries a valid `refs #4117` in its subject; it is already pushed, so rewriting history to move it buys nothing |
| 7 | build | Final review: outputSection's heading-count!=1 throw branch has no dedicated test (fails safe as offender) | fixed | New fail-closed test covers a missing and a doubled heading for both predicates; goes red when the catch returns true (c79638ddd) |
| 8 | build | SDD ruling — fix the design-wrapper Output to caller gap in the final-review fix wave rather than defer: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
| 9 | build | SDD ruling — fix-wave implementer runs on sonnet (Standard), not the size:low Fast default: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | |
| 10 | wrap-up | pr — PR #4356 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | |
