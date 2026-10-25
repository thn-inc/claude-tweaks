# Open Items — reconcile: background archive-run commit lands on a linked worktree's feature branch instead of main

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Premise reversed: #4178's incident commit 24ef60e0b was made on the main checkout's local `main` (main reflog `main@{2026-10-24 17:31:12}`), not in a linked worktree. The spec-3997-2724 worktree inherited it via `worktree.baseRef: head` before local `main` was rebased to 49302ee0a. The source mechanism, unpushed local-`main` `[reconcile] archive run` commits riding along into new worktrees (the #1780 ride-along stop fires only under `DISPATCH_HEADLESS=1`), is #3396's Deliverable 2 territory and is not fixed by this build. Route: add this evidence to #3396, or file a follow-up for the source fix. | open | — |
