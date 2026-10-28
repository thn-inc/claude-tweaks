# Open Items — Write gate misreads cp/mv value-taking options (-S/--suffix)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — skip rules stay duplicated between explicitTargetDir and the new GNU operand loop: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — BSD reading reports the destination directory, not .bak/a and .bak/b: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | review/3b | `cp a b -t d e`: the -t directory was the only destination reported, but macOS's BSD cp and mv treat -t as a source word and write e/a and e/b (medium, tiebreak-confirmed) | fixed | The BSD reading is reported alongside the -t directory unless an option BSD lacks (-t, -S, a long option) comes before the first operand; the mutants for it turn the suite red |
| 4 | review/3b,3c | A lone `-` operand was dropped by both operand loops, so `cp a -` reported no destination (low, tiebreak-confirmed twice) | fixed | A lone `-` is an operand in both loops; a destination word starting with `-` is reported as `./-` because resolveWriteTarget reads it as a flag |
| 5 | review/3b | The BSD destination skipped dash words, so `cp a b -v` missed the real BSD destination -v (low, tiebreak-confirmed) | fixed | The BSD reading takes every word from the first operand on, as probed on macOS (/bin/cp writes -v/a and -v/b) |
| 6 | review/3c | The #4449 rows never ran `--sparse`, `--no-preserve`, a missing option value or the no-destination shapes (low, tiebreak-confirmed) | fixed | Rows added for each; every rule in the cp/mv branch has a mutant that turns the suite red |
