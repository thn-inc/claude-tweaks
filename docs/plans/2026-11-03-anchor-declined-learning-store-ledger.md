# Open Items — Anchor the declined-learning store at the main checkout

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `reconcile()` calls `pruneDeclines()` with no root, so a run from a linked worktree, a test suite's included, now locks and can prune the main checkout's store | observation | Intended by the spec: one store per repo. Only entries past the 180-day cutoff are removed. |
| 2 | build | The deleted-cwd test has been run only on darwin; its `os.tmpdir()` branch on Linux is first exercised by PR CI | observation | PR CI settles it. |
