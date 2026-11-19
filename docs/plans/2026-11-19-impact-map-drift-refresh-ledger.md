# Open Items — Refresh the test-impact map when drift makes it stop paying for itself

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | review | Drift-refresh trigger and adoption counted raw git-diff test files, not the drift selection would run (medium, impact.js) | fixed | Fixed in 607ae24d0 — selectableDriftCount filters to map-known, HEAD-present tests; tests added |
| 2 | review | Refresh marker wording said beside the map but lives in the git common dir; future-dated marker mtime blocked the refresh (low) | fixed | Fixed in 607ae24d0 — docs and comment say git common dir; only 0 <= age < window counts as recent |
| 3 | review | An old impact map can under-select unchanged tests whose reads moved on main (confirmed by fixture; ADR 0032 accepts the miss class, CI backstops) | deferred | Defer-reason: tangential — filed as #5952 → backlog |
