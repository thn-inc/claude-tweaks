# Open Items — wrap-up-engine.js plan reads its git facts from the main checkout when run from a linked worktree (#3925)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD minor: the journeys assertion in the #3925 test (tests/bin-lib/wrap-up/engine-cli.test.js) overlaps the #3431 AC1/AC3 test; it adds value only because main's rename empties that row under the revert | deferred | Origin: SDD task review, Task 1 (5215e82). Files: tests/bin-lib/wrap-up/engine-cli.test.js. Trigger: revisit if the #3431 journeys test is removed or reshaped |
| 2 | build | SDD minor: only the R (rename) candidate shape is pinned from a linked worktree; a D (delete) candidate is not exercised | deferred | Origin: SDD task review, Task 1 (5215e82). Files: tests/bin-lib/wrap-up/engine-cli.test.js, plugin/bin/lib/wrap-up/facts.js (parseRenamedDeleted). Trigger: revisit if parseRenamedDeleted's D branch or the references scope changes |
| 3 | build | SDD ruling — implementer runs only the focused test file; full suite runs centrally at Common Step 5: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
