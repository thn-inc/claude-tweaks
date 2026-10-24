# Open Items — verification-brief: under pr-first with the merge left open, the brief's screenshot commit lands on an already-merged branch

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 3 commits ahead of local main at /flow Step 2.5 (reason-not-auto: requires-judgment — rebase vs continue; auto chose continue) | fixed | Post-creation catch-up fast-forwarded the worktree branch 5ea8cb7 → bf79456 (origin/main tip); nothing left diverged |
| 2 | build | SDD ruling — key the Step 4 PR read on the run PR (pr-merge-state.js) and guard the integration branch: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — evidence PR via a scratch worktree, pathspec commit, no in-place branch switch: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — unreadable PR state counts as open only for an in-run leave-open console: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — final-review minors 4-9 folded into the fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — residual git-add Important fixed via one targeted fix round: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — state the worktree-path comparison for the run-own-branch definition, fixed now in Step 4.5: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | AC8.1 dropped-literal control proves assertRouting throws, not which assertion fires | observation | Parked by SDD controller — code stands: premise assertions confirm each literal is present, and the scoped re-reviewer's commit-literal mutation showed the intended assertion firing |
| 9 | build/skill | build/plan-authoring-checks.md has no check that traces where the session's cwd/branch is when a wrap-up Phase 4 step runs — #4039's plan assumed Step 4 runs in the run's worktree, but cleanup item 4 tears it down first; candidate cwd-at-step check alongside the Consumer-timing check | open | — |
