# Open Items — archive-run guard does not cover the dispatch bundle Auto-merge gate's log lines (#3740)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task-review minor: a mixed bundle group (one member's gate verdict is auto-merge, another's is needs-human) makes the detector return true although the group falls back to a Review Console, and no test pinned that choice | fixed | Commit a29356c82: kept the fail-safe direction (refuse archive; the console that renders writes the terminal-decision line). Pinned it with a mixed-group assertion in tests/bin-lib/reconcile/archive-merged.test.js and corrected the comment in plugin/bin/lib/reconcile/archive-merged.js |
| 2 | build | SDD task-review minor: the archive-run verb tests matched only the refusal prefix, not the reworded parenthetical | fixed | Commit a29356c82: the first bundle refusal test in tests/archive-run-verb.test.js asserts the exact parenthetical fragment |
| 3 | build | SDD task-review minor: fillDispatchTemplate replaced only the first {n} | fixed | Commit a29356c82: replaceAll for {n} and {issues} in tests/bin-lib/reconcile/archive-merged.test.js |
