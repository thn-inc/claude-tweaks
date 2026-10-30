# Open Items — Rebind the run PR body when a resumed run reuses a still-open PR (#4580)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of the worktree branch at /flow Step 2.5 (reason-not-auto: requires-judgment — auto mode continued past the divergence prompt) | fixed | Post-creation catch-up merged origin/main into the worktree branch — `3a1cd381e` |
| 2 | build | SDD ruling — keep `body` on every gh pr list row in listPrs (single list call, no extra view): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — drop the redundant non-string guard from namesOtherRun (repairPrBody already coerces; absent-body test pins it): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — add the Step 3 skip carve-out to the #4580 reused-PR rebind paragraph (plan text omitted it): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | review | Lens 3f (low, reproduced): Resume's Still-open rebind bullet in pr-early-run-lifecycle.md (line 465) was not pinned by assertReusedRebind | fixed | Pinned in assertReusedRebind plus a go-red test — `9b8ef0a48` |
| 6 | review | Lens 3f (low, tiebreak-confirmed): the gh-absent `mcp__github__update_pull_request` fallback in the #4580 rebind paragraph (line 105) was not pinned | fixed | Pinned in assertReusedRebind plus a go-red test — `9b8ef0a48` |
