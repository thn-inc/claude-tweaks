# Open Items — context-gauge.js writes a handoff for a top-level run whose only remaining step is wrap-up

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 1 reviewed without its per-task affected-set run (verify slot queued): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | Task 1 reviewer Minor: the refusal test pins the reason string literally instead of importing it | observation | Parked, code stands — the byte pin is deliberate (the brief fixes the exact text), so a drift goes red |
| 3 | build | Task 1 reviewer Minor: a dispatched single-record wrap-up handoff reads run-state.json twice | observation | Parked, code stands — the brief placed the refusal before the bound check; one redundant in-memory read on a path that already writes a file |
| 4 | build | Task 1 reviewer Minor: a top-level run at the handoff bound now reports the top-level reason instead of the bound reason | observation | Parked, code stands — both refuse the handoff; the top-level rule is the more fundamental reason to name |
