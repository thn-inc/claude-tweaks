# Open Items — Cut remote-protocol git work in the prune-remote, pre-review-catchup and claims-git-cas test fixtures

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead at run start; caught up by the post-creation merge | observation | Informational: merged origin/main into the worktree branch before building |
| 2 | ops | Pre-flight branch-divergence-check on resume run 2026-11-16T183940: origin/main was 5 commits ahead; caught up by the adopt-path merge (reason-not-auto: informational only, already resolved by the catch-up merge) | observation | Informational: merged origin/main into the worktree branch (35c97a6b6e) before building |
| 3 | build | SDD ruling — per-test writes.get(n).ok assert satisfies AC3: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — shared claims registry and catch-up shapes override the replicate-exactly constraint: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | build | SDD ruling — spawn-test git cost resolved by measuring helpers-git-template.test.js too and reporting the net: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 6 | build | SDD ruling — keep the skipFetch test fetch --prune (it simulates the shared-fetch caller): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 7 | build | SDD ruling — claims shared-registry saving is 3 base builds, not claim writes: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 8 | build/skill | Moving a remote-heavy test file onto git templates follows one shape no skill documents: a sibling fixtures module (no node:test) with one fromTemplate/fromTemplateSet key per variant, build-time values cached as the build's last statement and returned as fresh copies, one spawn test per variant in helpers-git-template.test.js, and only setups two or more tests share templated; each spawn test also pays the template build in its own process (~800 git processes for #5769) [skill: NEW - git-template-fixtures] | observation | Observation for wrap-up's Skills curation row |
