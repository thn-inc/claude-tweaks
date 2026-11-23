# Open Items — Floor map, emission 2/8: Vocabulary and validation

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — stations.js exports REASON_UNSPECIFIED; emit.js names the normalized code through it: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — pin stripper mis-parse through both literal scans, including the pre-existing station scan: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — a new-contract exited line is one whose payload has an own actor key: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — residual final-review test gap fixed with one targeted fix past the single fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | invalidReason (pre-existing closed-set checks) still interpolates raw event.kind/station/outcome/lane, so a Symbol there drops as append failed rather than naming the field; seen by Task 1 re-review | observation | Fixed in this build by the final-review fix wave (commit 60bfa1cf4: show() wraps those four messages; Symbol-kind test added) |
| 6 | build/docs | docs/reference/station-events.md still lists the old outcome closed set (passed, failed, returned, skipped, abandoned) and kinds; #6146 added sent-back/stopped, planned/replanned/held/released/decided, REASON_CODES, ACTORS and new drop reasons | deferred | Defer-reason: blocked-dependency — the spec assigns this doc's contract text to record 8/8 (#6152), which retires the legacy outcomes; Non-Goals forbid editing it here |
