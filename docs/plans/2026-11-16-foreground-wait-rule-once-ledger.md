# Open Items — Dispatch prompts: state the foreground-wait rule once, in the context pack, and remove the four template copies

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — keep the duplicated renderTaskPrompt opts and express AC2 check across two suites: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build/skill | skill-prose-conformance-tests: its Doctor-by-structural-boundary section (and transcript-payload-verification's six-claim-sites count) cite tests/foreground-execution-instruction.test.js shapes #5601 removed (the exactly-two Foreground-paragraph split) — the instance is now historical, so the skill may want a live example | observation | — |
| 3 | review | docs/skill-graph.md:272 stale wait-rule copy count (seven, now three), medium | fixed | Corrected to three in commit 81db2e15e. |
| 4 | review | task-prompt.md item 7: log-the-downgrade and redirected-to-a-file facts lost their test pin when TEMPLATE_KEEP_ALIVE was deleted, medium/low | fixed | Both patterns added to ITEM7 (go-red proof via assertEachPatternGoesRed), commit 81db2e15e. |
| 5 | review | Low test-quality findings: duplicated RENDER_OPTS and templateDefects across suites, pipeline-test-scope heading anchor, AC1 go-red form | accepted | Duplication already ruled by staged/sdd-ruling-1.md; other three read as non-actionable (the AC removes one specific paragraph and its go-red test catches it; the go-red proof shows the counter reads 2 on restored text). Below the materiality floor, no digest entry written. |
