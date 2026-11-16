# Open Items — Write timing.json in code when a run closes, for every run (#5555)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Own-slug transcript rule covers 20 of 93 closed no-timing November runs: 73 dispatched runs keep their session transcript only under the main checkout slug (their Task-call subagent transcripts sit under that session's subagents dir). AC9 fixes this build to own-slug only; attributing a dispatched run's own subagent transcripts by the run id they name (the tools/guard-refusals/transcripts.js rule) would lift token coverage | deferred | Defer-reason: needs-human-decision. Widening the rule changes AC9.2's contract (a run whose slug has no transcript gets no token totals); evidence in the run dir evidence/dispatched-slug-check.txt. Stage a follow-up record proposal at wrap-up |
| 2 | build | SDD ruling — deriveTiming takes an explicit wantTokens option so phase-timing output is unchanged: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — run-timing.js falls back to worktreeAtClose on a closed run: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — timing-at-close.js carries no main-checkout anchoring check: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — token rows clipped to run creation through close, not the event span: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — collectDispatches window clip (run-timing.js:214) has no test, staged unfixed: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | Reconciler-closed runs (archive-merged.js archiveRunDir on a not-clean run) take run-state updatedAt = the archive terminal write as the token window end, possibly hours after the last turn; only a second run sharing the same session+worktree transcript leaks in. Better bound: pre-archive updatedAt or last event. | observation | — |
| 8 | build | A dispatched session /dispatch turns before the run id is minted (~11-15% of session tokens) fall outside the creation-to-close token window by the stated rule, though they serve the one record. | observation | — |
| 9 | build | When both the run dir and its archive twin are missing (or run-state.json is gone with no twin), the at-close SKIP targets the twin and is dropped silently; only the archive removes run-state, so it needs a vanished archive. | observation | — |
| 10 | build | No production writer sets run-state createdAt; runWindow createdAt input (lib/timing/run-timing.js) is fed only by tests. | observation | — |
