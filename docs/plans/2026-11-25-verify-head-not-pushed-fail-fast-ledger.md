# Open Items — verify.js waits out its CI window on a HEAD that was never pushed instead of failing fast

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | ci-source.js isMissingCommit maps HTTP 404 (repo not visible to gh) to head-not-pushed, which now exits 3 without localRuns with a misleading "not on the remote" message — map only 422/No commit found | deferred | Defer-reason: needs-verification — GitHub's 404-vs-422 answer for an unknown sha on commits/{sha}/pulls needs a live probe before narrowing #4347's classification (whole-branch review minor 2) |
| 2 | build | SDD ruling — early fallback notice held until after the CI loop, not printed at the decision point: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
