# Open Items — #3854 verify report.js git calls omit windowsHide

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead at pre-flight | observation | Caught up — worktree branch includes origin/main (0ac46ab14); it also carries one local-only ride-along `[reconcile] archive run` commit (5a4293816) from local main |
| 2 | ops | #3854 file-overlaps open #2987 on plugin/bin/lib/verify/report.js | observation | Warning only (Step 2.8) — built #3854 alone as named; #2987 touches the pass-stamp path, not the git-call options |
| 3 | build | SDD task review minor: tests/windows-hide-spawn-conformance.test.js header comment does not describe the injected-runner shape the scanner now matches | fixed | Header paragraph added in Common Step 3's simplification pass (comment-only; focused suites 27/27) |
| 4 | build | SDD task review minor: scanner identifier collection is file-scoped — a same-named unrelated call in one file would be flagged | accepted | Zero instances in plugin/bin (reviewer grep); a false positive fails the repo-wide test loudly, so it can never pass silently — it surfaces as a red test naming file:line |
| 5 | build | SDD task review minor: a direct-require default (`x = require('child_process').execFileSync`) is not captured | accepted | Zero instances in plugin/bin (reviewer grep); the codebase convention destructures or binds the module first, both of which are matched |
