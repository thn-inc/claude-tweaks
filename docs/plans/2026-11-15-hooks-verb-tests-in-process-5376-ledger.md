# Open Items — Move the remaining hooks.js verb tests onto the in-process helper

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — reworded the plan-mandated real-process comment in tests/hooks-check-pass-reentry.test.js to the true reason (Task 2): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — updated the tests/hooks-js-flag-strict.test.js pin and kept the env thread-through into reconcile() (Task 5): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — reconcile passes its cwd to the declined-learning prune, reversing the plan (Task 5): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — no separate task reviewer for the measurement task; the whole-branch review checked its file (Task 6): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build/skill | Extends .claude/skills/gh-api-module-pattern (cli-wrapper-contract.md): an in-process test of a verb that acts on its working directory with no path argument (reconcile) needs a fail-closed guard on the lib function that refuses a cwd other than the injected one, reinstalled per call when a test helper reloads the module, because a cwd regression would otherwise run the real pass against the runner checkout before any assertion fails | observation | — |
