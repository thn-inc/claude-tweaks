# Open Items — Give the below-floor parent close an MCP transport path for gh-absent sandboxes

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — fold the vacuous sub_issues assertion fix into Task 2: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — default-branch row fail-open stated in the Transport paragraph: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — native-parent mapping row keeps a prose gh cell: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — multispec-preflight-failure.md issue_read wording left as is: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — skip the label bootstrap on the MCP path: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | github-write-transport.md comments row's gh column (`gh api .../comments?per_page=100`) has no --paginate while its MCP column now pages | deferred | The gh column mirrors what call sites actually run (failure-check.md, settle-and-merge.md, release/bookkeeping.md all use the unpaged form); paginating the row alone would misdescribe them, and widening every gh call site is outside this record. Defer-reason: tangential |
| 7 | build | verification-brief.md Step 1's own label bootstrap has no stated MCP-path behavior (the Transport paragraph scopes to the Parent-Gate Procedure) — pre-existing, surfaced by the #205 rewording | observation | — |
| 8 | build | The MCP body-text sentence in the Transport paragraph implies but does not say the agent runs the session-tmp-resolve.js line first to get $WRAPUP_PARENT_BODY's path | observation | — |
| 9 | build | brokenSpanLines guard misses double-backtick spans and `gh -R x issue …` flag-first shapes (neither occurs in the guarded text today) | observation | — |
