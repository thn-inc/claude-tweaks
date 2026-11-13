# Open Items — Turn on the worker read block and re-open only the test command's toolchain

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch divergence: origin/main was 3 commits ahead of local HEAD at Step 2.5 (reason-not-auto: informational, auto-continued per policy) | observation | Caught up by the post-creation catch-up merge (worktree at 24ff44c81 includes origin/main 20e09a14f) |
| 2 | build | SDD ruling — refuse / and unnormalized caller-given readPaths entries: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — canonicalRealpath instead of the plan fs.realpathSync in realToolchainDeps: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — reword the AC7 live prompt to run each command exactly as written: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — one targeted fix for two final-review residuals: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | Task 4 cosmetic minor: worker.test.js canary assignment spacing; roles.js header line wrap width | fixed | Fixed in the final-review fix wave, commit f0b327b1c |
