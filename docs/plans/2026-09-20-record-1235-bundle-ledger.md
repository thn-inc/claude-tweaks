# Open Items — Bundle: #2613,#2603,#2538,#2526,#2398,#2282,#2257,#2063,#1996,#1936,#1798,#1769,#1235

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | test | Pre-flight sweep (unmodified base, post-merge with origin/main @ 7e52089e3): `npm test` reports 3 pre-existing failures in `tests/impeccable-plugin-contract.test.js` (#7255 "the installed plugin matches the pinned version", #7259 "gatherSignals() executes cleanly and returns the documented shape", #7260 "the CLI entrypoint accepts no flags") — all rooted in a local machine/plugin-version mismatch (installed impeccable-plugin versions [3.0.6, 4.2.0, 4.2.2, 4.3.1] vs. pinned 4.0.2), unrelated to any record in this bundle. | accepted | Pre-existing — see ledger #1, batch pre-flight sweep. Local environment plugin-version drift, not caused by or fixable within this bundle's scope. |
