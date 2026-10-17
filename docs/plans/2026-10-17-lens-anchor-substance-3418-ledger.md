# Open Items — Review lens pairs: anchor findings on the defect line and match near-location pairs on substance (#3418)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Ruling: stale wide-floor prose in docs/plugin-structure.md:202 and two journey docs is in Task 1's scope (prose twins of the retired constant) — fixed in 1c3e44c53, ec95cac00 | observation | Ruling recorded during SDD Task 1; cost if wrong: two extra doc commits |
| 2 | build | tests/multi-agent-coordination.test.js:319 reworded LOOSE comment starts lowercase, drops "The same issue" | deferred | Cosmetic; final whole-branch review triaged optional |
| 3 | build | No wide-band boundary test with a pair just under 0.2 | deferred | Added in the final-review fix wave (212b46310) — boundary test asserts 0.1667 does not pair and 0.2143 does |
| 4 | build | step3-lens-dispatch.md:94 "(the same threshold as inside ±2)" nested in an em-dash parenthetical, harder to scan | deferred | Cosmetic; final whole-branch review triaged optional |
| 5 | build | Defect-anchor conformance go-red control mutates only "first occurrence" | deferred | Plan-sanctioned shape; final review: acceptable as-is |
| 6 | build | Defect-anchor Calibration-block check only asserts absence of the "defect's own line" literal | deferred | Ordering assertions are the stronger guard; final review: acceptable as-is |
| 7 | build | Defect-anchor ordering assertion partly duplicates review-coverage-anchor-conformance's ordering test | deferred | Harmless; final review: acceptable as-is |
| 8 | build | SDD Ruling: LOOSE lowercase comment, step3:94 nested parenthetical, and Task 2's three test-style minors left as-is | observation | Final reviewer triaged them cosmetic/acceptable; cost if wrong: minor readability only |
