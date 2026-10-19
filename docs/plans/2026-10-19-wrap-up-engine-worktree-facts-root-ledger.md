# Open Items — Fix wrap-up-engine plan reading repo facts from the main checkout inside a linked worktree (#3431)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Task 1 review minor: subdirectory test's mkdtemp `sub-` dir is untracked inside the worktree fixture (cleaned by `git worktree remove --force`; harmless) | deferred | origin: SDD task review of c1ee2dcfd; files: tests/bin-lib/wrap-up/engine-cli.test.js; trigger: revisit if fixture cleanup ever stops using `--force` |
| 2 | build | SDD Task 1 review minor: `resolveFactsRoot` and `resolveRepoRoot` are near-identical `execFileSync` wrappers | deferred | origin: SDD task review of c1ee2dcfd; files: plugin/bin/wrap-up-engine.js; trigger: consolidate into one runner if a third git-root resolver appears in this file |
| 3 | build | SDD Task 1 review minor: no direct unit test for `resolveFactsRoot`'s git-failure fallback to `cwd` | deferred | origin: SDD task review of c1ee2dcfd; files: plugin/bin/wrap-up-engine.js; trigger: revisit if the fallback branch grows beyond the `resolveRepoRoot`-mirroring try/catch |
