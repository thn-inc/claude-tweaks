# Open Items — #6000 lens reviewer worker role and launcher

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight divergence: origin/main was 42 commits ahead at run start | fixed | Post-creation catch-up merged origin/main into the branch (d42ffa3f6 -> 20e0a2c2c) |
| 2 | build | SDD ruling — Task 3's "worker env holds only ENV_ALLOW names" test asserts env keys ⊆ ENV_ALLOW ∪ keys(lensGitEnv(...)) and that GH_TOKEN/GITHUB_TOKEN/ANTHROPIC_API_KEY are absent: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — Task 2b re-review minor: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Task 3's four re-review minors are fixed in Task 4's dispatch (separate commit), not deferred: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — Task 4 re-review minor: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — Task 4 re-review minors: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — Task 4 re-review minor: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | SDD ruling — Task 5 minor: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 9 | build | SDD ruling — final-review residuals (isGitDenial shapes, false comment, untested envelope-first order): ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 10 | build | SDD ruling — residual git-denial scan gaps after the targeted fix: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
