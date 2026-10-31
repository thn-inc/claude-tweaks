# Open Items — hooks.js archive-run ignores unknown flags such as --dry-run and archives for real (#4773)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | review | Lens 3a (low, tiebreak-confirmed): KNOWN_FLAGS comment at plugin/bin/hooks.js:170 named only two of the three resolveRunArg callers with no entry, omitting check-session-residue | fixed | Auto-applied under review-auto-apply-ceiling=medium, commit 2dfdcfb19; scoped re-verify pass (5040/5040) |
| 2 | wrap-up | Reflect (light, Fresh start): every hooks.js verb that takes flags should refuse an undeclared one — `reconcile --dryrun` still runs a real reconcile pass | deferred | Backlog record proposal staged at staged/reflect-1.md (Queue writes). Defer-reason: tangential |
| 3 | wrap-up | Reflect (light, Friction): #4773 was filed without keyFiles, so build's one-file micro-plan path fell through to a full plan and SDD loop | deferred | Memory proposal staged at staged/wrap-up-memory-1.md (Memory updates). Defer-reason: tangential |
| 4 | wrap-up | Residue sweep: the suite probe did not run (fact pack uses --no-suite by design) | observation | Suite state comes from verify.js instead: full run at dcd29e5b5, 20777 tests, 0 failed. Review's scoped re-verify at 2dfdcfb19 was 5040/5040. PR #4775 CI test check green at 3e4d273c4. Every other residue probe ran clean, and there were 0 gate denials this run |
