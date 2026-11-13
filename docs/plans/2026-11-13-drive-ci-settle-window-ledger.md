# Open Items — drive.js reports CI before the pushed commit's tests have started (#5277)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight divergence: origin/main was 3 commits ahead of local main at run start (local main also 4 ahead with reconcile-archive commits); worktree catch-up merged origin/main | open | — |
| 2 | build | SDD ruling — WINDOW_POLLS helper defined once at module top of run.test.js: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — no-ci override spares red/inherited-red and running non-Actions checks: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | Follow-up idea: ciStep's gh run list --commit duplicates the read pr-checks.js already makes each poll (pr-checks.js ~line 217); reporting the head-run count in the pr-checks envelope would drop the extra call (final-review design note) | open | Defer-reason: tangential — needs a pr-checks.js envelope change outside this record's files; route via /claude-tweaks:capture at wrap-up |
| 5 | review | Test quality (medium, steps.js:901): no test pinned the commit-run re-read after a settled none; a read-once mutant survived the suite | fixed | Fixed in c3bdcf13a: new run.test.js case drives none then some under a running non-Actions check; the runs === null mutant fails it (12 other ci tests stay green) |
| 6 | review | Error handling (medium, steps.js:921): with no Actions run the no-ci override also rewrites a failed final pr-checks read (read-failed, gh-absent, no-pr) to no-ci, so a read failure that cannot see non-Actions checks reads as no CI; staged as review-1.patch, coupled to sdd-ruling-2 | open | — |
