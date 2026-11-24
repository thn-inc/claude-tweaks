# Open Items — Refuse to ready or merge a pipeline PR while its run is still building

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence: origin/main was 1 commit ahead at run start | fixed | Merged origin/main into the worktree branch at Common Step 1 catch-up (f315f201bb) |
| 2 | build | SDD ruling — Task 2 writes the `Phase exit` entry in every route except a closed run (`isClosedRun` ...: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — plan-mandated AUTO status for the Phase exit record collides with the Review Console's ...: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | the shared shell walker does not see gh pr merge inside if/while/for bodies, $(…) or backticks (the same blindness affects git push gitTargets) — the in-flight gate inherits that bypass class; fixing the walker touches every gate that reads it. | deferred | SDD minor, triaged by the final whole-branch review: stands; documented as the gate's Known gaps in docs/hooks.md. Defer-reason: genuinely-larger |
| 5 | build | SDD ruling — Task 3 re-review out-of-scope notes (git-command.js:3977 doc comment omits the new stan...: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 6 | build | SDD ruling — plan-mandated 'not MERGED → no entry' leaves a transient PR-state answer (network-failu...: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 7 | build | SDD ruling — a transient byBranch answer (network-failure) on the no-pr-field route is held as hollo...: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 8 | build | SDD ruling — Task 5 re-review out-of-scope note (hollowCandidatePr's positive-integer guard has no t...: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 9 | build | SDD ruling — the implementer's deviation stands — detectHollowMerges' 'not-github-issues' and 'no-re...: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 10 | build | SDD ruling — the three residual gate follow-ups meet the fix-now criteria (small, in lines the fix w...: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 11 | build | SDD ruling — the abbreviated-long-option gap is the same defect the residual fix targeted, a one-exp...: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
