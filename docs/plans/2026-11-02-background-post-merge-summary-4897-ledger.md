# Open Items — Background post-merge summary counts a failed-close run as ran

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight: origin/main was 4 commits ahead of local main; the worktree caught up to 1f54ee150 | observation | Worktree caught up at creation; the main checkout's mirror did not fast-forward (dirty) |
| 2 | ops | File overlap with #4798 on `plugin/bin/lib/reconcile/post-merge.js` (draft PR #4947 in flight) and #3977 on `plugin/bin/lib/reconcile/format-summary.js` | observation | Warning only; the split with #4798 is stated in the spec. Expect a text conflict at whichever merges second |
| 3 | build | SDD ruling — doc states what the code does over the plan wording on postMergeOne entries: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | ratified at Review Console — the doc states what the code does, since the spec only requires the description to match |
| 4 | build | SDD ruling — fix the CLI naming gap in this build rather than file it: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | accepted | ratified at Review Console — the record's own goal is that the reader can act, and it is one helper and one row |
| 5 | build | SDD ruling — journeys leave out the Step 4.0b failure until #4798 ships it: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | accepted | ratified at Review Console — #4798 ships that behaviour and can add the clause then; the follow-up is now in #4798's body |
| 6 | review | session-start.js:358 pointed at decisions.md when Step 4.0's append had failed (medium, Error handling) | fixed | d354a62e1: `postMergeFailedLogMissing` drops the pointer |
| 7 | review | hooks.js:1899 failed runs' closed parents unpinned (medium, Test quality) | fixed | d354a62e1: summary test added |
| 8 | review | session-start.js:359 record numbers rendered with no integer check (low, Security) | fixed | d354a62e1: `filter(Number.isInteger)` |
| 9 | review | hooks.js:1877 failed-run rule written three times (low, Ownability) | fixed | d354a62e1: one exported `isFailedRun` |
| 10 | review | tests/reconcile.test.js:2656 hand-built NODE_OPTIONS (low, Convention) | fixed | d354a62e1: `requireOption` |
| 11 | review | post-merge.js:462 `records.unchecked` unpinned at the summary (low, Test quality) | fixed | d354a62e1: summary test added |
| 12 | review | reconcile-background.test.js:298 grab-bag test (low, Test quality) | fixed | d354a62e1: split into three tests |
| 13 | review | docs/reconcile-checks.md:729 list omits `reopened` (info) | accepted | Tiebreak: `reopened` is a clean Step 4.0 outcome, not one it "could not settle"; lines 691-692 name all four |
| 14 | review | post-merge.test.js:716 bare AC tag (info) | accepted | Tiebreak: comment-only; dotted AC tags are common across tests/ |
| 15 | review | format-summary.js:74 CLI row has no `parentFailures` test (info) | accepted | Tiebreak: loop entries carry no `parentFailures` until #4798, so the CLI cannot hit it; `classifyEntry` pins the verdict directly |
| 16 | wrap-up | #4798's body does not state what this record leaves it (add the Step 4.0b clause back to both journeys, remove the `docs/reconcile-checks.md:731` clause); Ledger: staged/wrap-up-reflect-insights.md row R1 | fixed | #4798's body now carries both follow-ups under Follow-ups from #4897 |
| 17 | wrap-up | pr — PR #4957 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | Decided at the Review Console |
| 18 | wrap-up | suite probe — skipped via --no-suite in the residue pack | observation | Full suite ran at 1fb64ceea through bin/verify.js: 21980 tests, 0 failed |
