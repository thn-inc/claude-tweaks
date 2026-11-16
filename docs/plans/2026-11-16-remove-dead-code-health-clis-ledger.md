# Open Items — Remove dead code from the four health CLIs (#5536)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 7 commits ahead of local HEAD when the run started; continued under auto. | observation | Post-creation catch-up merged origin/main into the worktree branch (cb6f8bcc5a to 29c1d02575); no action needed. |
| 2 | build | SDD ruling — commit trailers use the latest session link, not the plan older one: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — scratchpad dir is the current session one, not the plan older path: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — plan evidence files written to the scratchpad, not the run dir: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — Task 8 full-suite step folded into the build one verification: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — keep the filename main-exitcode-integration.test.js: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | Parked: validateRiskArg's argName/cmdName/consequence params in plugin/bin/code-health.js now have one caller after pull-issues was deleted (spec keeps the function) | observation | Left for /simplify (Common Step 3); not a defect, an unused degree of freedom |
| 8 | build | Stale-history comments outside the record's list: 'exactly as before' tails in plugin/bin/lib/{docs-health,harness-health,journey-health}/cache.js createDurable comments, plugin/bin/materialize.js:284-289, the #1837 history in plugin/bin/lib/plugin-version.js, scope.js contentHash header placement | deferred | Defer-reason: tangential — comments describe history, not behaviour this record's deletions made false; whole-branch review accepted the deferral; candidate for one comment-sweep record |
