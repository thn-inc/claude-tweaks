# Open Items — Attribute dispatched runs' subagent transcripts to timing.json token totals

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Adjacent gap seen while probing: a NON-dispatched interactive run launched from the main checkout (then EnterWorktree, as every worktree-always /flow does) has its {sid}.jsonl under the launch slug, not the worktree slug, so at-close still writes no token totals; #5647 widens only dispatched runs (its AC). Candidate rule: for a non-dispatched run, the run's own sessionId transcript under any slug, clipped to the run window. | open | Defer-reason: tangential — outside #5647's acceptance criterion (dispatched runs only); route at wrap-up via the deferral gate |
| 2 | build | SDD ruling — Task 2 agent fixtures carry two rows per agent (sum(X, X)): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — "Unchanged" means totals and dispatches; the SKIP reason text extends: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Dispatches scoped per directory by content (superseded by the provenance ruling): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — Dispatches scoped per directory by provenance: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — Run-state writer leaving worktree:null on a clean dispatched run is a follow-up: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
