# Open Items — Attribute dispatched runs' subagent transcripts to timing.json token totals

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Adjacent gap seen while probing: a NON-dispatched interactive run launched from the main checkout (then EnterWorktree, as every worktree-always /flow does) has its {sid}.jsonl under the launch slug, not the worktree slug, so at-close still writes no token totals; #5647 widens only dispatched runs (its AC). Candidate rule: for a non-dispatched run, the run's own sessionId transcript under any slug, clipped to the run window. | open | Defer-reason: tangential — outside #5647's acceptance criterion (dispatched runs only); route at wrap-up via the deferral gate |
