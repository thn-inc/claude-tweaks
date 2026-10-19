# Open Items — ledger row parsers ignore GFM's escaped pipe, so an open row can count as unrecognized

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Task 1 minor: ledger-cells.test.js round-trip test repeats the backslash inputs inline instead of a shared constant (cosmetic) | accepted | Final whole-branch review triage: cosmetic and below the materiality floor; the plan brief prescribed the test shape |
| 2 | build | SDD Task 1 minor: no test for a backslash before an ordinary char (`a\x\|b`) | fixed | Test added in daa09bbde (tests/bin-lib/wrap-up/ledger-cells.test.js) |
| 3 | build | SDD Task 2+3 minor: statusline now requires ./lib/wrap-up/ledger-cells at module load | accepted | Final review triage: pure 32-line module, and the statusline already requires ./lib/color relatively — no action |
| 4 | build | Follow-up from final review (not a regression): flipLedgerRow writes Resolution text verbatim, so a bare `\|` in a resolution yields an 8-slot row a later flip refuses; _shared/ledger-format.md also never tells writers to escape a literal pipe as `\|` | open | Defer-reason: tangential — outside #3353's reader-only scope; file a backlog record (escape bare pipes in flipLedgerRow's resolution + a ledger-format.md writer rule) at the Review Console |
