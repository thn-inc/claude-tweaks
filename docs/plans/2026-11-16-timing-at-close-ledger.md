# Open Items — Write timing.json in code when a run closes, for every run (#5555)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Own-slug transcript rule covers 20 of 93 closed no-timing November runs: 73 dispatched runs keep their session transcript only under the main checkout slug (their Task-call subagent transcripts sit under that session's subagents dir). AC9 fixes this build to own-slug only; attributing a dispatched run's own subagent transcripts by the run id they name (the tools/guard-refusals/transcripts.js rule) would lift token coverage | deferred | Defer-reason: needs-human-decision. Widening the rule changes AC9.2's contract (a run whose slug has no transcript gets no token totals); evidence in the run dir evidence/dispatched-slug-check.txt. Stage a follow-up record proposal at wrap-up |
