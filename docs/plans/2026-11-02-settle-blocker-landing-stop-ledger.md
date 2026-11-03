# Open Items — 4792: Teach /dispatch Settle to treat a /flow pre-claim blocker-landing stop as a non-failing stop

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow | Pre-flight branch-divergence check: origin/main was 54 commits ahead of the resumed branch at run start | fixed | Merged origin/main (da6186a2f) into the branch before re-planning |
| 2 | flow | Pre-flight branch-divergence check (run 2026-11-03T114010): origin/main was 12 commits ahead of the resumed branch at run start | fixed | Post-creation catch-up merged origin/main (1af3cb018) into the branch before Task 1 |
| 3 | flow | Pre-flight branch-divergence check (run 2026-11-03T163449): origin/main was 2 commits ahead of the resumed branch at run start | fixed | Post-creation catch-up merged origin/main (65bee9ec7) into the branch before Task 1 |
| 4 | build | SDD ruling — Task 5 plugin-structure.md screen clause applies under every work-links value: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 5 | build | SDD ruling — Task 6 malformed-blocker bullet test fact matches "under every work-links value": ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 6 | build | SDD ruling — Task 6 notes-paragraph test matches the capitalised sentence: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 7 | build | SDD ruling — Task 5 real-input probe justifies zero malformed entries by body content: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 8 | flow | Pre-flight branch-divergence check (run 2026-11-03T163449, call 2): origin/main was 7 commits ahead of the resumed branch at call start | fixed | Post-creation catch-up merged origin/main (a3b372518) before Task 1; pre-review catch-up merged #4432 (e83634e5a) before the whole-branch review |
| 9 | review | Settle special case read an unreadable decisions.md as the unclaimed branch (settle-and-merge.md:117) | fixed | Now counts as the claimed case so step 1's ownership check decides the release; pinned in settle-blocker-landing-stop-conformance.test.js (714ae3285) |
| 10 | review | dispatch-unlanded-blockers.js had no --help short-circuit (line 90) | fixed | --help and -h print the usage and exit 0; test added and shown red without it (714ae3285) |
| 11 | review | Native-missing re-run branch with every candidate missing was untested (dispatch-unlanded-blockers.js:198) | fixed | New test; red when the checked.length guard is dropped (714ae3285) |
| 12 | review | preflight-records.test.js:1314 test name claimed a verdict it does not assert | fixed | Renamed to the return values it asserts (714ae3285) |
| 13 | review | closedBlocker fixture carried number 0, the value the screen rejects (unlanded-blockers.test.js:29) | fixed | Fixture takes its real number (714ae3285) |
| 14 | review | FAULTS raw run hard-coded positional 13, so the 1.5 row failed on a check its comment did not name (unlanded-blockers.test.js:293) | fixed | Positionals come from the pool; the 1.5 row now pins the argument check (714ae3285) |
| 15 | review | requireOrder re-declared in three new suites, 13 copies in tests/ (Defer-reason genuinely-larger) | deferred | staged/review-followup-1.md |
| 16 | review | Landed blocker verdicts re-probed on every pull, nothing cached (blocker-landing.js:253, genuinely-larger) | deferred | staged/review-followup-2.md |
| 17 | review | Native dependency query refetched on every pull under work-links native (preflight-records.js:245, genuinely-larger) | deferred | staged/review-followup-3.md |
| 18 | review | malformedRecords hand-mirrors preflight validation with a different bound (unlanded-blockers.js:56, genuinely-larger) | deferred | staged/review-followup-4.md |
| 19 | review | Near-miss Blocked by lines read as no blocker in every consumer (unlanded-blockers.js:64, genuinely-larger) | deferred | staged/review-followup-5.md |
| 20 | review | Bare /flow in the Step 6 special case (settle-and-merge.md:117) | accepted | Descriptive prose, not passed to the Skill tool; the same step uses the same form at lines 37 and 113 |
| 21 | review | Teardown skip removes a second release attempt (two-call-gate.md:43) | accepted | Deliberate: avoids a false or duplicate release comment; a stuck claim lapses on its TTL (_shared/issue-claims.md) |
| 22 | review | Compare calls re-run on every pull (blocker-landing.js:259) | accepted | Deliberate freshness for unlanded verdicts; the landed-only cache is staged as item 16 |
| 23 | review | failure-check.md:47 transient fallback for the blocker-landing stop | accepted | Defensive fallback reached only if Settle breaks its own rule; it keeps the grants, as Settle does |
| 24 | review | Lib exports the pure half and the CLI sequences (unlanded-blockers.js:121) | accepted | The repo's pure/I-O split; moving the sequencing would only move it |
