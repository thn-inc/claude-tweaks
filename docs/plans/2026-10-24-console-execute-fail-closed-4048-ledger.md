# Open Items — Fail closed when decideConsoleExecute runs without its ruling-text or merge-grant context (#4048)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow | Pre-flight branch-divergence-check: origin/main was 5 commits ahead of local main at run start | observation | Post-creation catch-up fast-forwarded the worktree branch 5ea8cb7 → 18a9fa1, so the build starts at origin/main's tip |
| 2 | build | SDD task review minor: `plugin/bin/lib/reconcile/console-execute.js` consoleExecuteDetect comment (~L405-410) says a `ctx: {}` fallback "would read as 'no merge row to check' and let the row through unchecked" — stale now that `ctx: {}` with a merge row fails closed as `grant-context-missing`; seeding `memberGrants` still matters for the specific `grant-unreadable` reason | fixed | e4fe23539 — comment now says seeding yields the per-member `grant-unreadable` reason instead of the generic `grant-context-missing` |
| 3 | build | SDD task review minor: `decideConsoleExecute`'s merge gate tests `hasMergeRow` twice (`if (hasMergeRow && missing) … else if (hasMergeRow)`) — nest the context check under one `if (hasMergeRow)` | fixed | e4fe23539 — single `if (hasMergeRow) { if (context missing) … else … }`, logic re-indented unchanged |
