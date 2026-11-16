# Open Items — 4626: Decide whether trust.js should keep reading acceptance verdicts

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | duplicated floor/ungradable grading guard between verdict and revocationOnly in trust.js (final review minor 3) | deferred | Defer-reason: blocked-dependency — the ADR 0035 contract step #5717 deletes one of the two copies |
| 2 | build | per-approved-record git-log scan in resolveOperationalOutcome (Task 1 parked) — Ruling: no change; inherent to option 2, trustRows has no perf budget | observation | — |
| 3 | build | SDD ruling — the plan-mandated unstructured revocationOnly test was fixed, not kept: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | review/test | 3f medium: revocationOnly MIN_SAMPLES floor (trust.js:550) pinned by no test | fixed | commit 6e99a231c asserts revocationOnly.verdict insufficient-evidence in the every-record-one-column case (total 7, 5 dispositioned); proved red with the floor removed |
| 5 | review/code | Low/info review findings: duplicated verdict guard (trust.js:497/549, already deferred in row 1), AC2 test uses real clock, AC2 deepEqual coupling (refuted), AC3 no new case | accepted | Tiebreak recommended drop for each: expand-half duplicate dies at the contract step (row 1), RECENT keeps the AC2 record in-window, the deepEqual pins what AC2 asserts, merge-lane-breaker.test.js already pins AC3 |
