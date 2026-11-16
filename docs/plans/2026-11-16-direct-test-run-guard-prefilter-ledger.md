# Open Items — Skip the node start in the direct-test-run guard hook for Bash calls it can never deny (#5794)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow | Pre-flight branch-divergence check: origin/main was 1 commit ahead of the base when the run started | fixed | Merged origin/main in the Post-creation catch-up — 2bc395ba2d |
| 2 | build | SDD ruling — Task 1 code-level minors fixed in fix round 1 instead of deferred: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — Task 1 tab-row minor folded into the Task 2 dispatch instead of a second fix round: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — No git check-attr assertion added to the LF line-ending test: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — Exit status gap fixed by piping to node instead of exec (always exit 0): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — HOOK_COMMAND deleted from the tests; runHook uses the pinned registration text: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — Cost of a payload over the 8192-byte cap stands as budgeted (3x row): ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | SDD ruling — Case-variant program names (NODE) get no change: the guard verdicts stay as on main: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 9 | build | SDD ruling — IFS is not specially restored when it was unset on entry: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 10 | build/skill | Skill observation: this build extends `.claude/skills/shell-scanner-bash-differential` with a sh twin that is a deliberate superset of its JS parser, not an equal copy (tools/direct-test-run-guard.sh): the proof was a replay of every recorded Bash command through each oracle configuration of the JS guard and through the sh twin under bash 3.2, dash and bash 5 (zero denied commands skipped), per-rule mutants on an archive extract, and LC_ALL=C because bash 3.2 matches bracket classes and counts ${#v} by character under a UTF-8 locale. | observation | — |
