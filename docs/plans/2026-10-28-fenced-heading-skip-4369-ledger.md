# Open Items — Make the merge gate and near-duplicate Current State reader skip fenced headings

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — batched Tasks 1 and 2 into one implementer dispatch and one task review: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — shared fencedLineMask helper also touches extractSection, beyond the plan two-function constraint: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — CRLF normalization folded into extractCurrentStateAnchors (fix-now, pre-existing in a touched file): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — unclosed fence in mergeStateDemands left as the shared helper defines it (shapeGate fails closed): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — duplicate "AC2.1:" test-title prefix left in merge-gate.test.js (house style): ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | Same defect class outside this diff (final review, declined to judge): record-body heading readers with no fence skip — `plugin/bin/lib/compose-record/compose.js` `splitSections` (~lines 22-38) and `plugin/bin/lib/flow/pr-body.js` (~line 242) — plus a divergent fence implementation, `fenceInfo` in `release-note-repair/apply.js` (~line 37: accepts indented fences, throws on unterminated). Sweep by pattern, not function name, and move them to `fencedLineMask`/`fencedLineRanges` | open | Defer-reason: pre-existing-outside-diff — none of these files is in this build's diff; route to a backlog record at wrap-up |
