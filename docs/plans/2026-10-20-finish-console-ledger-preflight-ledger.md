# Open Items — finish-console: decide whether a ledger row it cannot flip should stop it before steps 1-2 land

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task review minor: docs/journeys/approve-a-ledger-row-that-quotes-a-pipe-3512.md:41,53 and docs/journeys/close-out-only-this-runs-ledger-3566.md:39 still describe the old step-3-after-steps-1-2 order | open | — |
| 2 | build | SDD task review minor: wrap-up-engine.js atomicity comment says a refusal names the failing row, but a ledger-resolution failure names no row | fixed | Comment and docs/plugin-structure.md now name the failing row or the resolution/read reason — plugin/bin/wrap-up-engine.js atomicity comment, commit follows this row |
| 3 | build | SDD task review minor: finish-console's ambiguous/rejected/unattributable/unreadable pre-flight branches have no dedicated CLI test (the shared !resolved.ok path is covered by the no-ledger case; detail text unchanged) | deferred | Origin: SDD Task 1 review; files: tests/bin-lib/wrap-up/finish-console-cli.test.js; trigger: next change to finish-console's ledger resolution — Defer-reason: tangential |
