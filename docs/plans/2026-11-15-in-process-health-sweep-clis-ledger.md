# Open Items — Give code-health.js, docs-health.js and design-detect.js an injectable entry and run their tests in-process (#5381)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — narrow the two git-touching pins — keep strict equality on code and stdout, assert stderr by its …: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — keep the virtual-clock form of the two file-lock waitMs tests — tests/wall-clock-budget-conforman…: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — Minor 5 (GIT_* strip loop written out in three test files) is not changed — the neighbouring test…: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — the root-derived absolute paths in scope.js's dot-directory warning and empty-slice hash are part…: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — cmdValidateFindings stays exported with its (args, ctx) signature — the plan's Interfaces mandate…: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — fix the Important — the governing contract's "strip GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_COMM…: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build | SDD ruling — Minors 1-2 fixed in the same round (move withoutAmbientGitVars to tests/helpers/, add GIT_COMMON_…: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 8 | build | SDD ruling — tests/bin-lib/health-core/seed-durable-state.js has the same ambient-GIT_* setup exposure and doc…: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 9 | build | about ten test files inline their own four-variable GIT_* delete loop instead of tests/helpers/git-env.js — Defer-reason: tangential (a consolidation idea across unrelated files, not a defect in this change) | deferred | Deferred by SDD (Task 5) — Defer-reason: tangential; final review triaged it not-before-merge |
| 10 | build | journey-health/cli-validate-findings.test.js:336-339 passes { ...process.env } past sweepCli's strip — harmless (the refusal returns before any git call), outside this record's files | observation | Parked by SDD (Task 5) — outside this record's files; final review triaged it not-before-merge |
| 11 | build | SDD ruling — the user's plan-review decision was "normalize a relative --root once in run" (Reading B); every …: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
| 12 | build | SDD ruling — accept the dropped cmdChurnReport/cmdMark/cmdStatus exports — no importer exists, code-health.js …: ratify or reverse at the Review Console (staged/sdd-ruling-10.md) | open | — |
| 13 | build | SDD ruling — the stale comment above returnedCode (main-exitcode-integration.test.js:73-75, "harness-health.js…: ratify or reverse at the Review Console (staged/sdd-ruling-11.md) | open | — |
| 14 | build | SDD ruling — Minors 1 and 3 fixed now (1 is AC3's literal "never changes"); Minor 2 carried into Task 9's PR-b…: ratify or reverse at the Review Console (staged/sdd-ruling-12.md) | open | — |
| 15 | build | SDD ruling — fix the Important and Minors 1-3 in fix round 1. Minor 4 (missing flag value → TypeError stack) i…: ratify or reverse at the Review Console (staged/sdd-ruling-13.md) | open | — |
| 16 | build | SDD ruling — fix the Important and Minor 1 in fix round 1 (both are PR-body text read verbatim); Minor 2 needs…: ratify or reverse at the Review Console (staged/sdd-ruling-14.md) | open | — |
| 17 | build | SDD ruling — fix wave takes the Important plus Minors 2-5, 7, 8 (findings file items 1-7); Minor 6 (release no…: ratify or reverse at the Review Console (staged/sdd-ruling-15.md) | open | — |
| 18 | build | SDD ruling — design-detect keeps 5 spawnCli processes against AC7's 'one or two' — two are AC5/AC7 smoke pins,…: ratify or reverse at the Review Console (staged/sdd-ruling-16.md) | open | — |
| 19 | build | SDD ruling — keep design-detect's exported main though its removal condition is already met — spec Deliverable…: ratify or reverse at the Review Console (staged/sdd-ruling-17.md) | open | — |
| 20 | build | SDD ruling — residual finding 1 is not given a second fix wave (SDD's one-wave cap) — the shipped script is by…: ratify or reverse at the Review Console (staged/sdd-ruling-18.md) | open | — |
| 21 | build | in a deleted cwd, design-detect --mode without --claude-md or --design-integration crashes on repoRoot's uncaught cwd() fallback; base behaves identically and the code is outside the fix diff | observation | Parked by SDD (Final review) — outside this record's files; final review triaged it not-before-merge |
