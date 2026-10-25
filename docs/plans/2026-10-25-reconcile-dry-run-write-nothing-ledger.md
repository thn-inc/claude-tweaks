# Open Items — reconcile: make --dry-run write nothing, and record why an escalate or resolve failed

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | trackResidue treats a falsy/unexpected escalate result as success while resolve side treats it as failure — asymmetry undocumented (cache.js ~153) | deferred | Origin: SDD Task 1 review minor. Files: plugin/bin/lib/reconcile/cache.js. Trigger: next change to escalateResidue's return contract. |
| 2 | build | 'status escalation-failed' fallback reason text untested (cache.js ~154) | deferred | Origin: SDD Task 1 review minor. Files: plugin/bin/lib/reconcile/cache.js, tests/bin-lib/reconcile/cache.test.js. Trigger: next edit to trackResidue's failure recording. |
| 3 | build | 'resolved status records no error' test is characterization, not discriminating (cache.test.js ~295) | deferred | Origin: SDD Task 1 review minor. Files: tests/bin-lib/reconcile/cache.test.js. Trigger: next cache.test.js cleanup. |
| 4 | build | no clearResidue test through a cache batch with a failing resolve | deferred | Origin: SDD Task 1 review minor. Files: tests/bin-lib/reconcile/cache.test.js. Trigger: next change to clearResidue. |
| 5 | build | #4180 trackArchiveResult ok-result dry-run test only partly discriminating (resolve stub throws; count calls instead) — archive-merged.test.js ~2168 | deferred | Origin: SDD Task 2 review minor. Files: tests/bin-lib/reconcile/archive-merged.test.js. Trigger: next change to trackArchiveResult. |
| 6 | build | planClear and dry-run trackResidue duplicate a 2-line entry lookup (cache.js ~338/371) | deferred | Origin: SDD Task 2 review minor. Files: plugin/bin/lib/reconcile/cache.js. Trigger: a third caller needing the same lookup. |
| 7 | build | SDD ruling — fold all four final-review minors into the one fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 8 | build | Follow-up (pre-existing, kept unchanged per AC3.1): recordResidueFailure sets escalated:true before escalate runs, so a failed escalation never retries — its reason is now recorded (lastResidueError) but the record is never filed | open | — |
