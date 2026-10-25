# Open Items — release Step 3 records the reviewed tip with a second rev-parse after the tree check (sibling-fetch race)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Task review minor: `tests/release-review-tree-check-conformance.test.js` pinned only the `rev-list` clause to `$TIP`; `diff --quiet "$TIP" HEAD` was unpinned | fixed | commit 044d3b8fd (fix round 1; scoped re-review ADDRESSED, revert-proven in a scratch worktree) |
| 2 | build | Task review minor: `STALE_TIP_PHRASES` (`tests/release-reviewed-tip-conformance.test.js`) matches two exact old strings; a reworded second `rev-parse` would slip past it | observation | The positive FACTs pin the new single-resolution wording exactly once, so a reworded regression still trips them. See ruling row 4 |
| 3 | build | SDD ruling — fix minor #1 (unpinned tree-diff clause) now via one resumed-implementer round instead of deferring: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — minor #2 (narrow stale-phrase list) recorded as an observation, not fixed: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | wrap-up | Friction lens: 4 `wd-guard-refusal` events during build (3 `cat`/`sed` reads of repo files via a backslash-escaped-space path, 1 `node-eval-file.js` heredoc); no gate-denial, ask-user-question, or contract-violation events | observation | Already covered by open #4028 (PR #4205, "emit only guard-accepted command forms"); no new filing. Near-misses and Fresh start: no finding - the one near-miss (unpinned tree-diff clause) was caught by task review and fixed in 044d3b8fd (ledger row 1) |
