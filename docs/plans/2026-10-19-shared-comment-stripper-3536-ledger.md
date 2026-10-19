# Open Items — Harden exit-code-conformance's comment stripper and share one literal-aware stripper across the source scans

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 7 ahead of the session's HEAD (the merged #3352/#3464 branch) | fixed | New worktree branched directly from origin/main 52aabeb84; catch-up merge was a no-op |
| 2 | build | SDD Task 1 minor: helpers-strip-comments.test.js test 6's 'may keep text' half unasserted — its title overclaimed | fixed | Final review triaged must-fix; test retitled to 'a quote inside a regex with no later literal on the line blanks no code' (161aaf9b4) |
| 3 | build | SDD Task 1 minor: test 1 proves comment removal via absent x/y/z, not exact blanked output | accepted | Final review: can-wait — equal length + identical newline indices + absent letters cover the offset invariant |
| 4 | build | SDD Task 1 minor: tests 3 and 6 pass under the old stripper too | fixed | Test 3 (escaped-quote pin) gained a trailing /* x */ and now goes red against an escape-blind string branch (161aaf9b4, proven in scratch); test 6 kept as a regression guard |
| 5 | build | SDD Task 2 Ruling: the spec's AC1.1 grep (BRE \[\s\S\]) is vacuous — exit 1 even on the pre-change file | observation | AC1.1 verified with grep -rnF "replace(/\/\*[\s\S]*?\*\//g, '')" tests/: matches the old file at :56, none at HEAD; record the corrected grep at wrap-up |
| 6 | build | SDD Task 2 minor: new exit-code fixture line ~140 chars | accepted | File already carries longer lines |
| 7 | build | SDD Task 2 minor: exit-code self-test covers /* in a string, not // in a string | accepted | Spec asked for /* only; the old stripper deleted every // to end of line, so a // fixture would test the helper — covered by tests/helpers-strip-comments.test.js |
| 8 | build | SDD Task 3 minor: 'a mis-parse can only leave comment text in, never hide code' is false (4 disproving inputs) | fixed | Final review raised it to Important; helper header and path-guard comment now state regex literals are not modeled and can blank code (161aaf9b4) |
