# Open Items — calibration-report: the "last N runs" window sorts run ids lexicographically (#4464)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — fold the cli.test.js dated-fixture conversion into Task 1 so every commit stays green: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — calibration header says "run id(s) without a timestamp", not "archive entries" (spec-N ids are TSV-only): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — TSV-only stubs load their live run dir decisions.md/events.jsonl (single-segment runIds) so unarchived runs are not empty window slots: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — no calendar range checks in runIdTimestamp (every real id in range, machine-generated): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — residual untested-guard Minor fixed in this build via one targeted test dispatch plus scoped re-review: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | unlogged terminal-decision gap — only 59/2152 archived decisions.md carry the classifier's "Review Console: terminal decision" phrase and the 12 real window runs carry none, so consoleDist reads unlogged regardless of the window; a logging/classifier gap outside #4464 (final whole-branch review, declined to judge) | observation | Defer-reason: tangential — capture candidate for wrap-up routing |
