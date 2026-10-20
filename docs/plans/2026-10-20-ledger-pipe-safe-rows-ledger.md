# Open Items — Make ledger rows pipe-safe (#3512)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | finish-console flips can still fail step 3 after steps 1-2 land when a writer skips the \\| rule — a pre-step-1 dry run of the flips in wrap-up-engine.js would change the #2544 best-effort contract | deferred | Defer-reason: pre-existing-outside-diff — filed as #3684 (needs:definition) |
| 2 | build | wrap-up-engine.js (~line 560) comment claims a re-run re-derives state rather than duplicating it, but decisions.md is append-only so step-2 lines duplicate | deferred | Defer-reason: pre-existing-outside-diff — below materiality floor, routed to the digest: https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6280213349 |
| 3 | build | flipLedgerRow's newline collapse ignores a lone \r or U+2028 in a resolution — Ruling: negligible edge; finish-console payloads and agent writers use \n line breaks | observation | Parked at the final scoped re-review (SDD) |
| 4 | build | SDD ruling — Task 3 brief's insertion texts decoded from markdown-escaping backslashes to plain backticks with the escape form as the code span `\\|`: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 5 | build | SDD ruling — Release Note reword for whole-branch review Minor 4 applied to #3512's issue body by the controller: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
