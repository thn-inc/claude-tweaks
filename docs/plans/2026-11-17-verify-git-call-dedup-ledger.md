# Open Items — verify.js: ask git each read-only question once per invocation

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — dispatcher additions forwarded to every dispatch via shared-rules.md: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — before-trace NEW REPEAT rows removed only where provably nothing spawns between; others named: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — freshness test run 1 pins the dirty stamp, not an absent stamp (plan premise false): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — impact is-ancestor repeat fixed in-build rather than left as a follow-up: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — defensive invalidate after adjudicate kept, comment reworded: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | Final review parked observation — PR body's 3+3 per-file split of the 6 scoped status -z repeat rows is not checkable from trace-after.txt (no per-file breakdown); the total of 6 is. Ruling: counted from the per-file trace logs; the binding AC1 claim is the named row and its total | observation | — |
| 7 | build/skill | Build observation: verify.js now memoizes git answers per process with an explicit invalidate() at every tree-mutation point (plugin/bin/lib/verify/git-reads.js), the in-process counterpart of repo-info-cache's cross-process memo; no project skill covers this rule (memoize only reads that cannot change, invalidate at named mutation points, a red-capable stale test per memo) [skill: NEW - per-invocation-git-memo] | observation | — |
