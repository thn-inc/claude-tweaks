# Open Items — #3537 Migrate the four local-merge fences off eval of compose-subject --shell output

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 1 go-red expected-order literal was a plan defect; sorted order accepted: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | sweepShellEvalFences recognises only backtick fences (~~~, 4-backtick outer, and unterminated fences are not parsed) | deferred | — |
| 3 | build | sweep go-red fixtures carry --shell, SUBJECT_EXPORTS and eval together, so no single predicate alternative is pinned | deferred | — |
| 4 | build | AC2.2 --out-dir stdout assert was partly circular after the --shell round-trip test was deleted (addressed by final-review fix 69d16c3cc: real-sh round-trip with fixture #2267) | deferred | — |
| 5 | build | parseArgs(['2251']).shell === undefined assert is low-value (catches only removal of the key) | deferred | — |
| 6 | build | SDD ruling — final-review minors (backtick-only fence parsing, unpinned predicate alternatives, shell===undefined assert) left as-is: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 7 | build/skill | skill-prose-conformance-tests enrichment: tests/merge-subject-composer-conformance.test.js's sweepShellEvalFences takes the sweep root as a parameter so its go-red control runs the identical walk+extract+match over a temp tree (nested dir, indented fence), proving the walker as well as the matcher; the final review also found 4-backtick/unterminated fences in tidy/step-6-*.md and specify/spec-template.md that a ```-only extractor mispairs — worth a line under "An empty extraction passes the sweep for free" | observation | — |
