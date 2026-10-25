# Open Items — reconcile: background archive-run commit lands on a linked worktree's feature branch instead of main

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Premise reversed: #4178's incident commit 24ef60e0b was made on the main checkout's local `main` (main reflog `main@{2026-10-24 17:31:12}`), not in a linked worktree. The spec-3997-2724 worktree inherited it via `worktree.baseRef: head` before local `main` was rebased to 49302ee0a. The source mechanism, unpushed local-`main` `[reconcile] archive run` commits riding along into new worktrees (the #1780 ride-along stop fires only under `DISPATCH_HEADLESS=1`), is #3396's Deliverable 2 territory and is not fixed by this build. Route: add this evidence to #3396, or file a follow-up for the source fix. | resolved | Routed to #3396 with the reflog evidence and the `baseRef: head` mechanism: https://github.com/thn-inc/claude-tweaks/issues/3396#issuecomment-6397833993 (#3396 owns the source fix) |
| 2 | build | Record #4178's `## Release Note` ("Background reconcile no longer commits run-dir archival into a feature branch's worktree.") overclaims. The observed ride-along is not fixed here, and only the inherited-GIT_DIR vector is. The whole-branch review rated this Important. A reworded note is staged for the Review Console (staged/build-deviation-1.md). | open | — |
| 3 | build | Whole-branch review Minor 2: `plugin/bin/lib/staged-patch/stack-check.js:29-32` drops the same four repo-locating vars by hand. It could build on `repoPinnedEnv(env)` from `hooks/git-exec.js` so the list lives in one place. Out of this plan's scope (the plan excluded that file). | deferred | — |
| 4 | build | git-exec.js runGit treats an empty env object {} as set — child would get no PATH; harmless for the repoPinnedEnv callers | deferred | — |
| 5 | build | repoPinnedEnv default-argument (process.env) path not directly unit-tested; covered indirectly | deferred | — |
| 6 | build | new test's fixture git() helper inherits process env — a suite launched under a GIT_DIR-exporting hook would affect the fixture itself | deferred | — |
| 7 | build | archive-linked-wt temp dirs not cleaned up (matches sibling suites) | deferred | — |
| 8 | build | tests/sweep-stray-run-dirs.test.js has no GIT_DIR-set case proving hasTrackedWork's pin (re-review out-of-scope gap) | deferred | — |
