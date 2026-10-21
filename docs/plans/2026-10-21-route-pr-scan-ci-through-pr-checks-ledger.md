# Open Items — #3658 Route github-pr-scan current-pr item 3 and repo-wide item 1 through pr-checks.js --pr

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | item 1 FAILURE set counts CANCELLED/ACTION_REQUIRED as failing while classify.js FAILING_CONCLUSIONS does not — readers disagree on non-green rollups only | deferred | Origin: SDD Task 1 review (minor). Files: plugin/skills/_shared/github-pr-scan.md (repo-wide item 1 fence), plugin/bin/lib/pr-checks/classify.js. Trigger: revisit if a display/merge-gate disagreement on a cancelled check is reported, or when a shared rollup-conclusion vocabulary is extracted. |
| 2 | build | item 1 runs pr-checks.js serially once per rollup-green PR (up to 100) — bounded per spec, wall-clock cost on large PR queues | deferred | Origin: SDD Task 1 review (minor). Files: plugin/skills/_shared/github-pr-scan.md (repo-wide item 1 fence). Trigger: revisit if /tidy Step 4.8 wall-clock becomes a reported friction on repos with many open green PRs. |
