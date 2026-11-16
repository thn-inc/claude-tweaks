# Open Items — 5562: Delete each run's plan at wrap-up in this repository: set superpowers-plans-retention to prune-after-wrapup

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Wrap-up must delete this run's plan on the branch BEFORE the Review Console's gh pr merge (installed 6.170.0 runs cleanup item 1 after the pr-first merge; #3813's fix is unreleased): run the plan-citation-check, git rm the plan under docs/superpowers/plans/, commit, push, then confirm with gh pr view 5629 --json files that no docs/superpowers/plans file remains (AC3) | open | — |
| 2 | build | plugin/skills/dispatch/mcp-transport.md:47 cites an already-deleted plan (2026-08-02 dispatch-mcp-bridge) with no (deleted sha) annotation | deferred | Defer-reason: pre-existing-outside-diff — found by Task 1's reader audit; outside this record's Key Files |
| 3 | build | SDD ruling — Task 5 measurement commands stand as the spec wrote them: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — docs/donts.md IL-36 rule left without the cited-plan clause: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | build | SDD ruling — AC3 met by a pre-merge plan delete at wrap-up, not a plugin change: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
