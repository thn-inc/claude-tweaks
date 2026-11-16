# Open Items — 5562: Delete each run's plan at wrap-up in this repository: set superpowers-plans-retention to prune-after-wrapup

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Wrap-up must delete this run's plan on the branch BEFORE the Review Console's gh pr merge (installed 6.170.0 runs cleanup item 1 after the pr-first merge; #3813's fix is unreleased): run the plan-citation-check, git rm the plan under docs/superpowers/plans/, commit, push, then confirm with gh pr view 5629 --json files that no docs/superpowers/plans file remains (AC3) | fixed | Plan deleted pre-merge in a75652d88b after the plan-citation-check exited 1 (no citing file) |
| 2 | build | plugin/skills/dispatch/mcp-transport.md:47 cites an already-deleted plan (2026-08-02 dispatch-mcp-bridge) with no (deleted sha) annotation | accepted | Premise false on re-read: plugin/skills/dispatch/mcp-transport.md:47 already carries the deleted d83f0720 annotation, so there is nothing to fix or file |
| 3 | build | SDD ruling — Task 5 measurement commands stand as the spec wrote them: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | ratified at Review Console — the spec Decided text fixes both Task 5 commands verbatim |
| 4 | build | SDD ruling — docs/donts.md IL-36 rule left without the cited-plan clause: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | accepted | ratified at Review Console — donts.md keeps one rule plus one clause of why; ADR-0034 carries the cited-plan exception |
| 5 | build | SDD ruling — AC3 met by a pre-merge plan delete at wrap-up, not a plugin change: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | accepted | ratified at Review Console — the spec forbids plugin edits and the fix is unreleased, so the pre-merge delete (row 1) meets AC3 |
| 6 | wrap-up | pr — PR #5629 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
