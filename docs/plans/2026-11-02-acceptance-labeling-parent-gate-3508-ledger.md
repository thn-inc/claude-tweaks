# Open Items — engine-verify.js: acceptance-labeling's gated/resolved parent handling disagrees with the Parent-Gate Procedure

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — pending plus approved labels read as gated, so the plan test case changed: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | ratified at Review Console — dispositionState ranks changes-requested over pending over approved (acceptance.js), so pending plus approved is gated, not resolved, and the code stands |
| 2 | build | SDD ruling — go-red control merged into the AC3.1 twin test, overriding the separate plan test: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | accepted | ratified at Review Console — the spec's AC says each new test fails with today's condition restored, and a stand-alone control has no code dependency, so it stays green there; the spec outranks the plan |
| 3 | review | Stale `skipped` declaration comment omitted the resolved-parent skip reason (engine-verify.js:933, low) | fixed | Comment now names the resolved parent; auto-applied |
| 4 | review | Stale `twoParentRow` helper comment claimed #898 always stays incomplete (engine-verify.test.js:1977, low) | fixed | Comment now covers the already-dispositioned case; auto-applied |
| 5 | wrap-up | pr — PR #5008 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
| 6 | wrap-up | suite — project suite not re-run by the residue probe (skipped via --no-suite); suite state comes from /test's verification stamp | observation | — |
