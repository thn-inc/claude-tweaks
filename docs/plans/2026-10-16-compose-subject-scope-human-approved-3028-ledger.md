# Open Items — build / compose-subject stderr, --scope, human-approved tag (#3028)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight: local main carried a foreign unpushed commit (bec288319) not on origin/main | fixed | Worktree branch reset to origin/main d2a26abf0 before the materialize commit; local main left untouched for its owning session |
| 2 | build | plugin/skills/_shared/github-pr-scan.md is 45,927 B before this change — 153 B under its 46,080 B ceiling; Task 3 appends the `[human-approved]` exclusion there | open | Measure with wc -c after Task 3; trim the insert if it would cross the ceiling |
