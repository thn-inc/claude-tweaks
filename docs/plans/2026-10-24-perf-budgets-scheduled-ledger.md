# Open Items — Nothing runs the perf/ wall-clock budgets automatically, and the session-failures lock wait is asserted nowhere (#4067)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 1 may edit docs/plugin-structure.md's perf/ line and test:perf command row although the plan's Files list omits it: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | test-perf.yml concurrency group repeats the workflow name (test-perf-${{ github.workflow }}), harmless, copied from test.yml | deferred | — |
| 3 | build | session-failures.test.js lock-wait test's cleanup(id) is not in a finally, so a failing assertion leaves the pid-scoped temp file behind (pre-existing shape) | deferred | — |
| 4 | build/ops | New `.github/workflows/test-perf.yml` (daily schedule + `workflow_dispatch`, never a PR gate) — review the workflow diff; after merge, run it once (`gh workflow run test-perf.yml`) and confirm it goes green, since `workflow_dispatch` and `schedule` only fire from the default branch (reason-not-auto: requires-signoff) | open | — |
