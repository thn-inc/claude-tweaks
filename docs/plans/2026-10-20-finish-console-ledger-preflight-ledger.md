# Open Items — finish-console: decide whether a ledger row it cannot flip should stop it before steps 1-2 land

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task review minor: docs/journeys/approve-a-ledger-row-that-quotes-a-pipe-3512.md:41,53 and docs/journeys/close-out-only-this-runs-ledger-3566.md:39 still describe the old step-3-after-steps-1-2 order | fixed | Both journeys updated to the pre-flight/nothing-written behavior — fa560325c, 0b4ef4d98 |
| 2 | build | SDD task review minor: wrap-up-engine.js atomicity comment says a refusal names the failing row, but a ledger-resolution failure names no row | fixed | Comment and docs/plugin-structure.md now name the failing row or the resolution/read reason — plugin/bin/wrap-up-engine.js atomicity comment, commit follows this row |
| 3 | build | SDD task review minor: finish-console's ambiguous/rejected/unattributable/unreadable pre-flight branches have no dedicated CLI test (the shared !resolved.ok path is covered by the no-ledger case; detail text unchanged) | fixed | Phase 1 fix-exhaust (fix-now: one file in this diff, no external state): five CLI tests cover the ambiguous, unattributable, two rejected and unreadable branches, each red against origin/main's engine — e7bbf70e0 |
| 4 | wrap-up | pr — PR #3796 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
