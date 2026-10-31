# Open Items — hooks.js archive-run ignores unknown flags such as --dry-run and archives for real (#4773)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | review | Lens 3a (low, tiebreak-confirmed): KNOWN_FLAGS comment at plugin/bin/hooks.js:170 named only two of the three resolveRunArg callers with no entry, omitting check-session-residue | fixed | Auto-applied under review-auto-apply-ceiling=medium, commit 2dfdcfb19; scoped re-verify pass (5040/5040) |
| 2 | wrap-up | Reflect (light, Fresh start): every hooks.js verb that takes flags should refuse an undeclared one — `reconcile --dryrun` still runs a real reconcile pass | deferred | Backlog record proposal staged at staged/reflect-1.md (Queue writes). Defer-reason: tangential |
| 3 | wrap-up | Reflect (light, Friction): #4773 was filed without keyFiles, so build's one-file micro-plan path fell through to a full plan and SDD loop | deferred | Memory proposal staged at staged/wrap-up-memory-1.md (Memory updates). Defer-reason: tangential |
