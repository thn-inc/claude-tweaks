# Open Items — Stage ledger-backed proposals through one CLI call instead of the dispatch.md three-step prose dance

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — stage-then-append order instead of the spec literal append-first order: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — AC1.1 pin kept as the spec literal line-count grep: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — dispatch.md --ledger prose trimmed to shape, call, guarantee, exit branches: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — concurrent row-number take renumbers the owned staged file instead of discarding it: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | parseLedgerTable's duplicate-key Map collapse also makes flipLedgerRow (finish-console) drop a duplicate-numbered row on write — plugin/bin/lib/wrap-up/ledger-write.js | deferred | Defer-reason: pre-existing-outside-diff — origin: #3510 final whole-branch review (I3 follow-up); file plugin/bin/lib/wrap-up/ledger-write.js is untouched by this diff; revisit when finish-console or delete-ledger next changes; record proposal to be staged at wrap-up |
| 6 | build | Residual from final fix-wave re-review: dispatch.md says branch on stderr "starting" with the degraded prefix, but stage-item.js prints log-write warnings before it | observation | Parked at SDD Finish (no second fix wave); fixed in /build's post-SDD fix-now pass — `37bbd1c47` |
| 7 | build | Residual: journey line 31 says "no row, no staged file" though the removal-failed SKIP leaves the staged file | observation | Parked at SDD Finish; fixed in /build's post-SDD fix-now pass — `37bbd1c47` |
| 8 | build | Residual: cli-wrapper-contract.md:11 degraded-outcome list omits the unsafe-numbering case | observation | Parked at SDD Finish; fixed in /build's post-SDD fix-now pass — `37bbd1c47` |
| 9 | build/skill | gh-api-module-pattern's cli-wrapper-contract.md gains a Sanctioned-writer that overloads exit 3 with logged degraded outcomes, told apart by a stderr prefix — already written into the contract (lines 11, 38) in this diff | observation | Extension recorded in-diff; wrap-up Skills curation may judge whether the stderr-prefix branch generalizes |
