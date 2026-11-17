# Open Items — Build the archive-tracked-shells test fixtures once per process (#5845)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight divergence: the main checkout's local main is 13 commits behind origin/main and carries 5 unpushed reconcile archive commits; this run's worktree branch was set to origin/main, so the build is unaffected (reason-not-auto: syncing the shared checkout's main is the user's decision) | observation | No action in this run; reported to the user in the run summary. |
| 2 | ops | File overlap: open record #5718 (race fix in plugin/bin/archive-tracked-shells.js) will add tests to tests/archive-tracked-shells.test.js; whichever lands second merges main and builds its new tests on the template fixtures | observation | No action in this run; noted in the PR body and the run summary. |
