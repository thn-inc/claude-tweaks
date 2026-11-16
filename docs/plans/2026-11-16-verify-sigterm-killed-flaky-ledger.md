# Open Items — verify.js baseline adjudication calls a SIGTERM-killed file attributable though it passes in isolation at HEAD

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | a file killed in the full run whose isolated HEAD run fails only base-covered tests stays ATTRIBUTABLE (baselineInIsolation's waived list holds the file path, which passedIn never matches) — whole-branch review Minor 2 | deferred | Defer-reason: needs-human-decision — spec Deliverable 2 keeps a file attributable when its isolated HEAD run fails; extending the file-level waiver to baselineInIsolation (and verification.md's Waived full-run failures line) needs a human call |
| 2 | build | SDD ruling — Task 1 mutation probes run in a scratch checkout, not the shared worktree: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — Task 2 grep pattern vs the plan's own "timed-out" text: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — residual header-comment re-wrap fixed by one targeted dispatch: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
