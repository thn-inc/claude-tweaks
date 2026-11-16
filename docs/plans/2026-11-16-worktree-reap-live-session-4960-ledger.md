# Open Items — dispatch: a merged group's worktree can be deleted while the dispatching session is still in it (#4960)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 7 ahead of local main, which also carried 10 unpushed reconcile archive commits | fixed | Merged origin/main into local main and pushed (b1a0f20ef1); worktree branched from the synced tip, catch-up merges no-op |
| 2 | build | SDD ruling — worktree-hold.js may also require ../run-liveness/process-probe (resolveOwnerPid, claud...: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — Task 4 implements all four functions its Interfaces name (incl. releaseAgentHolds); the...: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — a .git FILE with no gitdir: line reads as unverifiable (held-unverifiable, reported), n...: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — the reviewer's ⚠️ "other removal paths (teardown-run.js)" is not a gap: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — across clean and archived tiers the newest run id wins (live still first), superseding ...: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — only the worktree-reaped site uses the widened lookup (includeClosed); worktree-reap-sk...: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | SDD ruling — SessionStart stamps a separate home key (session+home+pid), never moved by EnterWorktre...: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 9 | build | SDD ruling — ⚠️ "ExitWorktree cwd may be the just-removed worktree" is benign: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 10 | build | SDD ruling — the home stamp only adds: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
| 11 | build | SDD ruling — an agent_id literally home/main is unreachable (harness ids are a + hex): ratify or reverse at the Review Console (staged/sdd-ruling-10.md) | open | — |
| 12 | build | SDD ruling — the brief's docs/hooks.md bullet text predates Rulings C/D: ratify or reverse at the Review Console (staged/sdd-ruling-11.md) | open | — |
| 13 | build | SDD ruling — SessionEnd with reason "clear" releases no holds: ratify or reverse at the Review Console (staged/sdd-ruling-12.md) | open | — |
| 14 | build | SDD ruling — holdVerdict maps probeOwnerPid's alive-no-start-time and start-time-unavailable to held...: ratify or reverse at the Review Console (staged/sdd-ruling-13.md) | open | — |
| 15 | build | SDD ruling — the no-match archive scan stays (once per reap, background, 0.3-0.9 s measured); only t...: ratify or reverse at the Review Console (staged/sdd-ruling-14.md) | open | — |
| 16 | build | SDD ruling — carried minors T3 duplicated fixture, T4 redundant no-pid guard, T5 bullet length are n...: ratify or reverse at the Review Console (staged/sdd-ruling-15.md) | open | — |
| 17 | build | SDD ruling — recorded pidStartedAt '' reading free is acceptable: ratify or reverse at the Review Console (staged/sdd-ruling-16.md) | open | — |
| 18 | build | SDD ruling — the residual Minor (holdVerdict detail-only match) gets /build's one targeted fix (#388...: ratify or reverse at the Review Console (staged/sdd-ruling-17.md) | open | — |
