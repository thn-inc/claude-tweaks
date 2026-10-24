# Open Items — Nothing runs the perf/ wall-clock budgets automatically, and the session-failures lock wait is asserted nowhere (#4067)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 1 may edit docs/plugin-structure.md's perf/ line and test:perf command row although the plan's Files list omits it: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | test-perf.yml concurrency group repeats the workflow name (test-perf-${{ github.workflow }}), harmless, copied from test.yml | deferred | — |
| 3 | build | session-failures.test.js lock-wait test's cleanup(id) is not in a finally, so a failing assertion leaves the pid-scoped temp file behind (pre-existing shape) | deferred | — |
