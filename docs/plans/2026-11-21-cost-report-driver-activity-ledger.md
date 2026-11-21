# Open Items — Show in the cost report whether admitted records ever reached the driver

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 3 Step 4 runs the cost-report tests through tools/run-tests.js: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — plugin-version regex scanning every raw line needs no change: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — Task 2 review minors (walk duplication, serial scan, NaN firstTs, LANES guard) take no change: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — unreadable total stays a per-section sum under --section all (documented, not deduplicated): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | review | Convention (low) — funnel.js:99 hard-coded manifest filename instead of the writer's MANIFEST_FILE | fixed | Imported MANIFEST_FILE from run-manifest/write.js (0e6fb97a9f); the lane literal stays since LANES is an unnamed array |
| 6 | review | Convention (low) — funnel.js:80 DAY_MS re-declared instead of shared with spend.js | accepted | Intentional: tools/ keeps one local DAY_MS per report file (guard-refusals, guards, pipeline-cost-report, skill-gate-replay, wait-polls each declare theirs); spend's dayStart takes a Date, funnel parses day strings |
| 7 | review | Convention (low) — funnel.js:124 dispatch-firing scope predicate and transcript walk copied from collectSpend | fixed | Scope predicate extracted as spend.js transcriptScope and used by both reports (0e6fb97a9f); the directory walk stays separate, covered by SDD ruling 3 (spend's walk also discovers subagent trees) |
| 8 | review | Test quality (low) — funnel.js:87 and :154 inclusive window bounds unpinned at the boundary | fixed | Added since/until boundary runs and a firing at 2026-11-08T00:00Z; mutation of both comparisons turns two tests red (0e6fb97a9f) |
| 9 | review | Test quality (low) — spend.js:119 isRouteCommand has no negative case for a log-decision call with another --step | fixed | Added a log-decision.js --step "Step 2.8" negative; dropping the step condition turns the test red (0e6fb97a9f) |
