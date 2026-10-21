# Open Items — Make flow's resume-to-merge row workable for an unattended run

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 2 commits ahead of local HEAD (4dea52a99 #3595, 36fff7a2f #3768) | accepted | Continued under auto; the worktree's post-creation catch-up merged origin/main before any build work |
| 2 | build | SDD minor — `merge` with `--dry-run` unspecified (merge mode replaces Phases 1-4); also logged as the PRIORITY line | fixed | Token rules reject `merge` with `--dry-run` (52f3bc520) |
| 3 | build | SDD minor — docs/skill-graph.md said "two merge sites" | fixed | both rows say three and name merge-mode.md (52f3bc520) |
| 4 | build | SDD minor — empty `## Conflict` heading until Task 2 | fixed | Task 2 filled it (aca4b70fd) |
| 5 | build | SDD minor — docs/plugin-structure.md read condition stale after the narrowed router | fixed | narrowed condition stated (52f3bc520) |
| 6 | build | SDD minor — `## Conflict` re-entry had no stated bound | fixed | one-attempt bound, second DIRTY → pending-review moving-target (52f3bc520) |
| 7 | build | SDD minor — rail size test passed pre-change (regression guard, not AC5 go-red evidence) | accepted | final review: can-defer — a budget guard, AC5 go-red does not apply to it |
| 8 | build | SDD minor — Next Actions line "grants consoleAutoResolve" lacked backticks | fixed | backticked and pinned (52f3bc520) |
| 9 | build | SDD ruling — Task 1's MERGE_MODE_FACTS region is `merge-mode.md`'s text before its `## Conflict` heading (assert that heading's index is not -1), not the whole file: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 10 | build | SDD ruling — merge-mode.md names `_shared/pr-first-merge.md` Steps 1 through 4 (spec AC1 wording) instead of the plan's "Steps 1 through 3", keeping the Step 4.1 / Step 4.2-last split: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 11 | build | SDD ruling — route to merge mode only when $ARGUMENTS consists of nothing but the literal `merge` token, at most one record reference (either order), and this skill's own flags: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 12 | build | SDD ruling — final-review Minor 6 (pr-first-merge-post-merge Step 4.2 logs after reconcile archives, all callers) is pre-existing and out of #3784 scope: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 13 | build | SDD ruling — final-review Minor 8 (merge mode skips Section C step 3.5 pre-anchoring guard) left as-is: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 14 | build | SDD ruling — residual final-review finding (merge-mode.md branch-5 CLEAN-green "re-enter Step 2.5 from the top" has no bound, so a persistent unrecognized merge error loops) is real and load-bearing: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
