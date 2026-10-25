# Open Items — refreshOwnerBlock resolves the owner pid (up to 8 ps spawns) before checking the heartbeat throttle

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 3 commits ahead of the dispatch worktree's base | fixed | Post-creation catch-up fast-forwarded the worktree to ff0fc67ab |
| 2 | build | SDD ruling — default refreshOwnerBlock path skips every pid probe inside the throttle window; session-start opts in via restampWhileFresh:true to keep #3973's in-window resume re-stamp: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | context.js freshness check treats a future-stamped heartbeatAt (clock skew) as fresh, suppressing default-path re-stamps until the clock catches up | deferred | Origin: #4150 task review (minor). Files: plugin/bin/lib/hooks/context.js (refreshOwnerBlock freshness check). Trigger: an owner block observed stuck un-restamped behind a future heartbeatAt (same-host stamps share one clock; pre-existing property of the heartbeat branch). |
| 4 | build | docs/hooks.md Heartbeat paragraph stated the re-stamp with no throttle qualifier | fixed | 5c564dfea |
| 5 | build | Implementer concern: restampOwnerPidOnResume (session-start.js:77) may probe before the throttle | observation | Ruling: not a ps walk (ownerPidPatch reads CLAUDE_PID from env only) and runs only on source=resume SessionStart, never per tool call |
