# Open Items — Windows stub tests: skip the stub-dependent tests #4285 left running and move hand-rolled gh stubs onto installStub (#4433)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 2 commits ahead of the worktree branch at flow Step 2.5 | fixed | Merged origin/main into the worktree branch at the post-creation catch-up (d19ba3bb26 to 0175b0872c) |
| 2 | build | tests/verify-scope-declaration.test.js AC1.1/AC2.1 fail on git show v6.180.0:plugin/bin/lib/path-guard.js (path absent at that tag) — inherited from origin/main's release, not this build; Common Step 5 baseline adjudication decides | observation | Parked by SDD; informational |
| 3 | build | Out-of-diff observation (digest): tests/reconcile-archive-residue.test.js residue and ownerless tests make real network gh calls against acme/w on win32 (their comments are true; pre-existing environment cost, outside this diff) | observation | Parked by SDD; route to the digest at wrap-up |
| 4 | build | SDD ruling — controller runs no-code plan Tasks 5 and 6 itself: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 5 | build | SDD ruling — windows-regression run moved after Common Step 5: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 6 | build | SDD ruling — keep the positional AC4.1 label on the new path-stub tests: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 7 | build | SDD ruling — budgetTree stub dir removed at process exit, not in t.after: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 8 | build | SDD ruling — code stands for three install-order and comment nits the final review declined: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 9 | build/skill | windows-checkout-test-parity extends: a stub test whose outcome needs the stub to fail (an exit-1 gh shim making a lookup fail) passes on win32 only because the real authenticated gh hits a 404, so judge by swapping the stub's answer, not only by whether it is called (reconcile-archive-residue #4180/#4209 tests) | observation | Skill enrichment candidate for wrap-up's Skills curation row |
| 10 | ops | The branch carries the stalled run's materialized spec .claude-tweaks/pipelines/2026-11-26T124758-record-4433/work/4433-spec.md (commit 344cf0ebf2, pre-decision text) beside this run's; that run dir is archived in the main checkout — wrap-up decides whether the stale copy ships | open | — |
