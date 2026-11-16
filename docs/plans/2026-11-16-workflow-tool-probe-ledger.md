# Open Items — Probe what a plugin-shipped workflow can do, and record it

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow | Pre-flight branch divergence: origin/main was 1 commit ahead (6bad44e2a) when the worktree was created, and local main carried 1 unpushed reconcile-archive commit (a7d828e08) that rides along on this branch | observation | Caught up by the post-creation merge of origin/main (9e86a3172) before the first commit |
| 2 | build | SDD ruling — long-run re-run used two node timers instead of sleep 660 (Bash refuses a standalone long sleep): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — extra row agent-prompt-frame recorded beyond the record list: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — extra row long-run-nowait (wait ceiling disabled) recorded beyond the record list: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — init-routine and init-cloud recorded as not probed (no way to remove a probe Routine or cloud session): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
