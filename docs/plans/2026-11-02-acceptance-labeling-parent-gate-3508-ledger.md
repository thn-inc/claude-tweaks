# Open Items — engine-verify.js: acceptance-labeling's gated/resolved parent handling disagrees with the Parent-Gate Procedure

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — pending plus approved labels read as gated, so the plan test case changed: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — go-red control merged into the AC3.1 twin test, overriding the separate plan test: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | review | Stale `skipped` declaration comment omitted the resolved-parent skip reason (engine-verify.js:933, low) | fixed | Comment now names the resolved parent; auto-applied |
| 4 | review | Stale `twoParentRow` helper comment claimed #898 always stays incomplete (engine-verify.test.js:1977, low) | fixed | Comment now covers the already-dispositioned case; auto-applied |
