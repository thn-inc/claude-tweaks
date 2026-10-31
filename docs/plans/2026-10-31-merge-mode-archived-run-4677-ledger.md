# Open Items — wrap-up merge mode cannot resolve a pending-review run that wrap-up already archived (#4677)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 3 commits ahead of local HEAD at run start | observation | Caught up at worktree creation (merge of origin/main → 0cc5b501d); no action needed |
| 2 | build | SDD ruling — --archived name-tie (archived wins) is untested, no change: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — --archived archive/ candidates are not status-filtered: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — plan reconcile sentence was wrong, prose fixed: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — merge-mode.md paragraph length, no change: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | Final review minor: `/claude-tweaks:wrap-up #{n} cleanup-only` may not resolve an archived run, so merge mode's MERGED-precondition next step could dead-end | deferred | Defer-reason: tangential — a separate behavior outside #4677's ACs; filed as follow-up #4692 (needs:definition) |
| 7 | build | Re-review observation: merge-mode.md "Finish every decisions.md write first" (step 3) could point at Step 4.2's archive-path rule now that line 13 cites it | observation | No conflict: step 3 is about merge mode's own writes; wording note for the record |
| 8 | build/skill | `.claude/skills/hooks-js-verb-registration` covers adding a verb only; adding a flag to an existing non-flag-strict verb (#4677 `resolve-run-dir --archived`) touched the `VERBS` usage string, the verb handler's option parse, and the flag's home doc (`_shared/pipeline-run-dir.md`) — an enrichment candidate | observation | For wrap-up's Skills curation row |
