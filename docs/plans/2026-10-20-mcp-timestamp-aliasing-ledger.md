# Open Items — #3691 mcp-transport.md snake_case created_at/updated_at aliasing

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Task 1 minor: keep-existing and absent tests exercise only the createdAt branch, not updatedAt | accepted | Test-breadth polish; final whole-branch review triaged it "fine to leave deferred" — the data-driven loop covers both keys and the alias test checks updatedAt |
| 2 | build | SDD Task 1 minor: non-object element passthrough has no committed assertion | accepted | Test-breadth polish; final whole-branch review triaged it "fine to leave deferred" |
| 3 | build | SDD Task 1 minor: no-mutation test does not assert the output is a new object | accepted | Test-breadth polish; final whole-branch review triaged it "fine to leave deferred" |
| 4 | build | SDD Task 1 minor: a present createdAt:null is overwritten by a string created_at | fixed | Premise was false — the guard is `=== undefined`, so null is kept; docs reworded and the null case pinned by a test in b14018ca0 |
| 5 | build | SDD Task 2 minor: mcp-transport.md "every comparison is a tie" wording (comparator yields NaN) | accepted | Final whole-branch review checked it: `0 \|\| NaN` makes V8's sort treat same-band records as equal, so the wording is accurate |
| 6 | build | SDD Task 2 minor: section-names test asserts token presence only | accepted | Behavioral tests (doc heredoc, ranking, cache-hit round-trip) cover the claims the tokens name |
| 7 | build | SDD parked: MCP `state` casing (open/closed vs OPEN/CLOSED) is a separate field-shape gap outside #3691's spec, unconfirmed live | observation | Final whole-branch review declined to judge it; revisit only if a live MCP firing confirms lowercase state breaks the per-dependency OPEN check |
| 8 | build | SDD ruling — Task 2 discoverability pointers (mcp-transport.md queue-pull paragraph, queue-pull-script.md MCP note) ruled in scope despite the plan's file list: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 9 | build | SDD ruling — final-review Important 3 (unconditional alias step in queue-pull-script.md on both transports) taken now rather than filed: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 10 | build | SDD ruling — residual: on the MCP path alias_mcp_timestamps() is a shell function, lost if a Bash call starts below its definition (command not found, no set -e), silently restoring the degradation; left for the review phase: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
