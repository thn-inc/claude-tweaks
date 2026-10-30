# Open Items — Rebind the run PR body when a resumed run reuses a still-open PR (#4580)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of the worktree branch at /flow Step 2.5 (reason-not-auto: requires-judgment — auto mode continued past the divergence prompt) | fixed | Post-creation catch-up merged origin/main into the worktree branch — `3a1cd381e` |
| 2 | build | SDD ruling — keep `body` on every gh pr list row in listPrs (single list call, no extra view): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — drop the redundant non-string guard from namesOtherRun (repairPrBody already coerces; absent-body test pins it): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — add the Step 3 skip carve-out to the #4580 reused-PR rebind paragraph (plan text omitted it): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
