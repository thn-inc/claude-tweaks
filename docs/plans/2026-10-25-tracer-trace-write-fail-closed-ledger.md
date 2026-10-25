# Open Items — test-impact tracer drops a read whose trace write fails, with no fail-closed record

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Task review minor: tools/test-impact.js lost-refusal message read '(tests: )' when every .lost marker header is unparseable | fixed | 5b6026d66 — prints '(tests: unknown)', pinned by a new test in tests/test-impact-cli.test.js |
| 2 | build | Task review minor: tools/test-impact.js header exit-code paragraph wrapped awkwardly | fixed | 5b6026d66 — paragraph re-wrapped, wording unchanged |
| 3 | build | Task review minor: trace-refusal unit test covered one .lost marker only | fixed | 5b6026d66 — multi-marker test asserts count, sorted unique names, no map |
| 4 | build | SDD ruling — task brief augmented with the plan's Design section and the spec's ACs (task-brief extracts only the Task heading's section): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
