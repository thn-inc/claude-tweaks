# Open Items — Let a review-replay arm set its effort, and refuse to score a replay agent that ran at another (#5990)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of local main at flow Step 2.5 (the PR #5994 merge); reconcile fast-forwarded main before the worktree was cut and the catch-up merges were no-ops | fixed | Resolved before build: worktree cut at c38eb633f4 = origin/main |
| 2 | build | SDD ruling — transcriptEffort ignores synthetic API-error entries, departing from the Gotcha's literal text: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | review | Lens 3a (medium, reproduced): tools/review-replay/extract.js:19 re-declared the five effort levels beside the exported EFFORT_SCALE of plugin/bin/lib/model-profiles/profiles.js | fixed | Fixed in a350765d1a: parseArm validates effort= against EFFORT_SCALE, loaded with PROFILES; scoped re-verify passed |
| 4 | review | Acceptance criterion 6 (the PR quotes the reverted-branch red run of the criterion 4 test): the red run existed at evidence/ac6-red.txt but PR #6014's body did not quote it | fixed | Fixed: PR #6014 body now carries a Discrimination proof section quoting evidence/ac6-red.txt (AC4.1 fails 0 !== 3 with the effort-mismatch branch removed) |
