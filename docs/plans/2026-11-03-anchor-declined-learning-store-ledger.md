# Open Items — Anchor the declined-learning store at the main checkout

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `reconcile()` calls `pruneDeclines()` with no root, so a run from a linked worktree, a test suite's included, now locks and can prune the main checkout's store | observation | Intended by the spec: one store per repo. Only entries past the 180-day cutoff are removed. |
| 2 | build | The deleted-cwd test has been run only on darwin; its `os.tmpdir()` branch on Linux is first exercised by PR CI | observation | PR CI settles it. |
| 3 | review | `tests/reconcile.test.js` passes `cwd: <fixture>` to in-process `reconcile()` calls, so the real `pruneDeclines()` ran against the main checkout's store whenever the suite ran from a worktree | fixed | The file stubs the prune at load; the #4180 test keeps its own counting stub (4080bb4e7). Row 1's production effect stays as written. |
| 4 | review | A read-modify-write resolved the anchor three times (lock, read, write), so a transient stat error on a later resolution could split them across checkouts | fixed | `locked()` resolves the root once and hands the resolved store file to `readStore`/`writeStore` (4080bb4e7). |
| 5 | review | Nothing pinned the lock anchoring: reverting only the lock path passed every test | fixed | New test reads the lock dir from inside the critical section; reverting the lock path turns it red (4080bb4e7). |
| 6 | review | The store header still claimed every fs call is injectable, and a bare-repo worktree silently kept the per-worktree path | fixed | Header names the non-injectable anchoring and the unsupported bare/separate-git-dir shape (4080bb4e7). |
| 7 | review | Stale wording: `reconcile/index.js` and `plan-retention/cli.test.js` comments and a `storePath` test name still said cwd-relative | fixed | Reworded (4080bb4e7). |
| 8 | review | The new worktree fixtures spawned git through an unbounded `execFileSync` | fixed | `fixtureGit` supplies the 30s bound; the env pin stays (4080bb4e7). |
| 9 | review | A forged `.git` file redirects the store to any existing directory; a worktree-recorded subject now outlives its worktree | accepted | Needs local write access to plant a `.git` file git will not track, the suffix is fixed, and the resolver is shared by about 35 modules; subject lifetime is the intended behaviour with the 180-day prune in place. |
