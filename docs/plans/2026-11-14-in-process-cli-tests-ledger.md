# Open Items — Run the tests of already-injectable CLIs in-process (#5383)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of local HEAD at flow Step 2.5 (reason-not-auto: requires-judgment) | accepted | Divergence did not persist: main fast-forwarded to origin/main d3962cda8 before worktree creation, and the worktree's post-creation catch-up merge was a no-op at d3962cda8 |
| 2 | build | SDD ruling — T4's env-threading test sets both `GIT_DIR=<B>/.git` and `GIT_WORK_TREE=<B>` in the injected env (show-toplevel then prints B), and its cwd case uses a fixture repo whose policy differs from the checkout's: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — any other task that proves env threading through `git rev-parse --show-toplevel` uses the same GIT_DIR+GIT_WORK_TREE pair; `--git-dir`, `log`, `diff`, `remote get-url` read GIT_DIR alone: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Minor 2 (in-process unwritable --out case asserts exit 3 but not stderr) needs no change: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — later tasks run the fallback set (named files + importers + the four plugin/bin conformance scans) instead of verify.js --no-stamp: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — Minor (AC6.1's notStrictEqual(main, process.cwd()) guard is trivially true for a tmp dir) needs no change: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — Minor (new test's AC6.1: prefix collides with an older record's AC6.1 test at risk-flags-cli.test.js:245) needs no change: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | SDD ruling — Minors (fake git's `{ cwd }` destructure would throw if called with no options: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 9 | build | SDD ruling — Minor 2 (no direct unit test of defaultGit's new options) needs no change: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 10 | build | SDD ruling — Minor 1 (AC3.1's no-GIT_DIR baseline assertion alone cannot tell an honoured cwd from an ignored one) needs no change: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
| 11 | build | SDD ruling — envTmpdir mirrors os.tmpdir()'s own resolution from the injected env: ratify or reverse at the Review Console (staged/sdd-ruling-10.md) | open | — |
| 12 | build | SDD ruling — Minor 1 (relative --dir/--run now printed absolute) is an intentional change named in the PR body; Minor 2 (trivially-true notStrictEqual guard) needs no change, it is the plan-mandated accident guard: ratify or reverse at the Review Console (staged/sdd-ruling-11.md) | open | — |
| 13 | build | SDD ruling — thread cwd/env into the gh data seams now: ratify or reverse at the Review Console (staged/sdd-ruling-12.md) | open | — |
| 14 | build | Task 11 minor: missing space before the shared-primitives require in plugin/bin/release-local.js (its progress.md deferral carried an invalid Defer-reason, corrected to a fix-wave item) | fixed | Fixed in the whole-branch fix wave — 262797bcb |
| 15 | build/skill | windows-checkout-test-parity enrichment: a test comparing resolvePrinted's forward-slash output against an mkdtemp path must path.resolve both sides (digest-rollover-cli.test.js:584 broke every Windows run once its NOT_ON_WIN32 skip was removed) | observation | — |
