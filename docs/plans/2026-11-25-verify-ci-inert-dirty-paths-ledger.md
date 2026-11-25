# Open Items — verify.js: CI-sourced verdicts fall back to a local run when the only dirty path is bookkeeping-only

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 1 minor (inertDirtyPaths near-duplicates generatedExemption) rejected, no change: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — Task 2 minor (dirtyExempt ?? null fallback redundant) rejected, no change: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — final-review minor (firstRuleIndex exported with no outside caller) kept: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — final-review minor (verify.js reuses startDirtyPaths over the spec literal read) ratified as justified deviation: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build/skill | verify-scope-rule-kind extension: the verify event's ci subset (ciEventEntries in verify.js) is hand-listed like the impact subset and pinned field-for-field by ci-cli.test.js deepStrictEqual checks, so adding a CI entry field also touches about seven event pins plus impact-cli.test.js's report.ci pin | observation | Skill enrichment candidate for wrap-up |
