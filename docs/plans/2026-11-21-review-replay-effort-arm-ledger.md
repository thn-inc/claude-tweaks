# Open Items — Let a review-replay arm set its effort, and refuse to score a replay agent that ran at another (#5990)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of local main at flow Step 2.5 (the PR #5994 merge); reconcile fast-forwarded main before the worktree was cut and the catch-up merges were no-ops | fixed | Resolved before build: worktree cut at c38eb633f4 = origin/main |
| 2 | build | SDD ruling — transcriptEffort ignores synthetic API-error entries, departing from the Gotcha's literal text: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | review | Lens 3a (medium, reproduced): tools/review-replay/extract.js:19 re-declared the five effort levels beside the exported EFFORT_SCALE of plugin/bin/lib/model-profiles/profiles.js | fixed | Fixed in a350765d1a: parseArm validates effort= against EFFORT_SCALE, loaded with PROFILES; scoped re-verify passed |
| 4 | review | Acceptance criterion 6 (the PR quotes the reverted-branch red run of the criterion 4 test): the red run existed at evidence/ac6-red.txt but PR #6014's body did not quote it | fixed | Fixed: PR #6014 body now carries a Discrimination proof section quoting evidence/ac6-red.txt (AC4.1 fails 0 !== 3 with the effort-mismatch branch removed) |
| 5 | wrap-up | Reflect near-miss: spec Gotcha asserted every assistant transcript entry carries effort, from a single-transcript probe; synthetic API-error entries carry none (caught at final review) | deferred | Defer-reason: needs-human-decision — staged as a memory proposal via wrap-up's Memory row for Review Console approval (staged/wrap-up-memory-1.md) |
| 6 | wrap-up | Reflect near-miss: spec told the builder to validate effort= against a local five-value list although model-profiles EFFORT_SCALE already existed (review lens 3a, fixed a350765d1a) | accepted | Don't capture: CLAUDE.md's Read-before-you-write rule already covers duplicate constants; a one-off specify-time slip |
| 7 | wrap-up | Reflect friction: flow Step 2.8 file-overlap warning took 7 minutes fetching 836 open records | accepted | Already tracked as #5623 (unbounded overlap warning) |
| 8 | wrap-up | Reflect friction: dispatched implementers stalled ~20 minutes waiting on a sibling worktree's verify suite slot | accepted | Already tracked as #5168 and #5368 |
| 9 | wrap-up | pr — PR #6014 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
| 10 | wrap-up | suite — residue probe — skipped via --no-suite (fact pack); suite state from the verify pass: 143 selected files plus CI test run 44936596646, 0 failures | observation | — |
