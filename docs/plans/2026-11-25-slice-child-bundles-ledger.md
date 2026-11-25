# Open Items — Slice the lens-child and sdd-child composed bundles down to the sections their prompts cite

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — real-input probe ran against the main-checkout run dir: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — rail-row test pins sliced bytes via budgets.js constants, not a 15 KB literal: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — plan-mandated citer-naming pin fixed on the positive path: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | docs/plugin-structure.md compose-context row and journey 1988:130 run several hundred words on one line | observation | Not a defect: one physical line per row/bullet is those files' established convention; the added text is accurate (SDD task 3 review) |
| 5 | build | 3 skipped tests in task 3's scoped verify run, cause unchecked | observation | Diff adds no skip/todo; the final reviewer's focused run showed 0 skipped; Common Step 5's verify run is the branch's suite gate |
| 6 | build | tests/skill-size-single-source.test.js scanText checks RAIL_NAMES before numericLiterals, so a file shadowing a budgets.js name with its own numeric literal passes the guard (pre-existing, outside this diff; found by the fix-wave re-review) | observation | Outside this diff; routed to the run digest as an outside-diff observation per CLAUDE.md (Defer-reason: pre-existing-outside-diff) |
| 7 | build | docs/skill-graph.md:281 reads 'review-lens-child (two) (' awkwardly and repeats a context-cost.js path | fixed | Fixed in cc90adfbb2 (wording and the repeated path) |
| 8 | build/skill | compose-context-fencing gains named-section sources (registry sections, selectors must resolve, exit 2 on a miss); its #4359 bullet was updated in this branch, so wrap-up only needs to confirm it | observation | Skill updated in-branch (Task 3 + fix wave) |
