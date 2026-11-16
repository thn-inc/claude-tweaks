# Open Items — Resolve a run's spec header at its live or archived path in every reader

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 2 commits ahead of the branch at run start | observation | Caught up by the post-adopt merge of origin/main; no action needed |
| 2 | build | SDD ruling — Pre-flight: T8 require-check covers the six files that resolve headers directly (verify-run-bookends.js, lib/flow/preflight.js, lib/hooks/pre-tool-use.js, lib/wrap-up/pack.js, lib/dispatch/first-call-artifact-check.js, lib/timing/context-gauge.js); precondition.js and context-gauge.js (CLI) are scanned for the archive literals only: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — Task 1: plan-mandated require('./hooks/context') for RUN_ID_RE → require it from './hooks/run-dir-resolve' (its definition site): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Task 1: docs row 'a reader file naming it fails the AC8 source scan' stands: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — Task 2: verify-run-bookends.js USAGE plain-string mention of work/{n}-spec.md stays: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — Task 3: spec-N record dedup ([9,9] -> [9] for two live spec dirs naming one record) stays: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — Task 7: falsy runDir now returns null instead of throwing: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | SDD ruling — Final: drop final-wave items (a) zero-padded tie fixture, (c) hermetic env on new fixtures only, (d) AC9.2 comment, (g) pack mkdtemp cleanup, (h) pack.js:201 comment, (j) first-call cross-base precedence test: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
