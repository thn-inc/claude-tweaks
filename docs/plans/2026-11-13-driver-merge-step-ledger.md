# Open Items — Driver merge step: mark ready, read the checks, merge and post-merge in code

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence: origin/main was 1 ahead of local main at run start, and local main carried 1 unpushed reconcile-archive commit (49c80058a) that rides along in this branch (reason-not-auto: requires-human-judgment) | open | — |
| 2 | build | SDD ruling — per-task test runs use the fallback set (all tests/bin-lib/driver/*.test.js + every test importing a touched f: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — Task 1 re-review's two new Minors (merge.js:12-14 header exception attached to the wrong claim; merge.test.js:: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Task 2 Minor 1 (plan-mandated: no driver SKIP for exit-0 degraded closing-links results): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — Task 2 re-review's two comment Minors (merge.js:212-213 header omits exit-0 degraded SKIP; merge.js:205-207 CL: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — Task 3 Important 1 (plan-mandated second copy of classifyRollup's red/pending/empty/green rules in merge.js cl: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — Task 3 Minor 2 (plan-mandated 're-run compose(s) first' on re-entry): ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | SDD ruling — Task 3 Minor 5 ('15m' literal): ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 9 | build | SDD ruling — Task 3 re-review out-of-scope items carried in-build: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 10 | build | SDD ruling — Task 4 re-review comment-position nit (merge.test.js ~1258: '// The ciWaitMs of both watches is summed.' now a: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
| 11 | build | SDD ruling — Task 5 deviation 1: ratify or reverse at the Review Console (staged/sdd-ruling-10.md) | open | — |
| 12 | build | SDD ruling — Task 5 deviation 2: ratify or reverse at the Review Console (staged/sdd-ruling-11.md) | open | — |
| 13 | build | SDD ruling — Task 5 follow-up (gate pr-not-open detail loses CLOSED to neutralize) folded into Task 6's brief: ratify or reverse at the Review Console (staged/sdd-ruling-12.md) | open | — |
| 14 | build | SDD ruling — Task 5: ratify or reverse at the Review Console (staged/sdd-ruling-13.md) | open | — |
| 15 | build | SDD ruling — Task 5: ratify or reverse at the Review Console (staged/sdd-ruling-14.md) | open | — |
| 16 | build | SDD ruling — carried pr-not-open CLOSED-neutralize defect moved from Task 6's brief into Task 5 fix round 1 (same file, rev: ratify or reverse at the Review Console (staged/sdd-ruling-15.md) | open | — |
| 17 | build | SDD ruling — Task 7 Important 1 (plan-mandated step detail formula drops MergeResult.detail): ratify or reverse at the Review Console (staged/sdd-ruling-16.md) | open | — |
| 18 | build | SDD ruling — Task 7 AC15 note: ratify or reverse at the Review Console (staged/sdd-ruling-17.md) | open | — |
| 19 | build | SDD ruling — Task 7 re-review nits folded into Task 8's brief: ratify or reverse at the Review Console (staged/sdd-ruling-18.md) | open | — |
| 20 | build | SDD ruling — contract-beats-spec: apply or decline at the Review Console (staged/build-deviation-1.md) | open | — |
| 21 | build | SDD ruling — residuals after the fix wave fail the deferral gate (fix-now: small, in touched files): ratify or reverse at the Review Console (staged/sdd-ruling-19.md) | open | — |
| 22 | build | SDD ruling — residual code-comment Minor (merge.js:603-604 refusedStop doc comment says merge-refused leaves the PR ready: ratify or reverse at the Review Console (staged/sdd-ruling-20.md) | open | — |
