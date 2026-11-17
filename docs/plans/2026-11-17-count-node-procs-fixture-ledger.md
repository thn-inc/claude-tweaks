# Open Items — Give the count-node-procs real-run test its own small fixture test file (#5844)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight divergence: the main checkout's local main was 12 commits behind origin/main and carried unpushed reconcile archive commits; this run's worktree branch was set to origin/main, so the build is unaffected (reason-not-auto: syncing the shared checkout's main is the user's decision) | observation | No action in this run; reported to the user in the run summary. |
| 2 | wrap-up | pr — PR #5847 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | Open by design until the merge decision at the Review Console. |
| 3 | wrap-up | suite — the residue probe did not re-run the test suite (skipped via --no-suite) | observation | Suite state taken from the verification pass: PR CI run 44046769377 green on 61dc325a5 (tests 32275, pass 32255, fail 0). |
