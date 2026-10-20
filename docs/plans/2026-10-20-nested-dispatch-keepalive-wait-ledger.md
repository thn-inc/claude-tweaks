# Open Items — Probe a harness-sanctioned wait for the nested-dispatch keep-alive (#3714)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch divergence: origin/main was 3 commits ahead of local main (16ff94dcf release 6.148.0, 60553b16c changelog, fa8286fc8 #3563) at claim time (reason-not-auto: requires-judgment — whether to fast-forward the shared main checkout, which is dirty with another session's state) | resolved | Post-creation catch-up merged origin/main into the worktree branch (d170e1b4e → 77122811d); the shared main checkout is left for its own session's reconcile |
| 2 | ops | File overlap with open records #3657 (`plugin/skills/dispatch/task-prompt.md`) and #3675 (`plugin/skills/_shared/subagent-dispatch-core.md`) — whichever merges second must rebase onto the other's edits to the same paragraphs (reason-not-auto: requires-judgment — merge order across separately claimed records) | open | — |
