# Open Items — Adopt native re-wake for nested-dispatch children on Claude Code 2.1.302+ (#3722)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch divergence: local main d170e1b4e was 1 commit ahead (local-only reconcile archive) and 3 behind origin/main at claim time (reason-not-auto: requires-judgment — whether to push or fast-forward the shared main checkout, which another session owns) | resolved | Post-creation catch-up merged origin/main into the worktree branch (d170e1b4e → b1d7f54db); the local-ahead reconcile commit rides along on this branch; the shared main checkout is left to its own session |
| 2 | ops | File overlap with open records #3657 (`plugin/skills/dispatch/task-prompt.md`) and #3675 (`plugin/skills/_shared/subagent-dispatch-core.md`) — whichever merges second must rebase onto the other's edits to the same paragraphs (reason-not-auto: requires-judgment — merge order across separately claimed records) | open | — |
