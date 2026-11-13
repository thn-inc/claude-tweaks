# Open Items — Driver reviewer step: one read-only reviewer whose findings count only with a failing test

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — STEP_NAMES gets 'review' at its table position (after 'check'), not appended — the driv...: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — in Task 3's one-row-per-path-rule table, an example input that trips more than one rule...: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — the TODO and suite exclusions in classifyEvidenceRun stay pinned by synthetic rows buil...: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — Task 5 evidence TAP names are `{runDir}/review/review-evidence-{i}.tap` (i = index in r...: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — Task 7's evidence rewrite after the fix worker re-runs the canonical containment check ...: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — Minor 3 (review line denials[].tool_input unbounded) is not fixed in the wave — the rev...: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build | SDD ruling — glob-char refuses both the bracket/brace/paren set and `! + @`, which is broader than n...: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 8 | build | SDD ruling — a reviewer spendOverrun reaches no event line, and docs/driver.md's Ceilings bullet ("a...: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 9 | build | SDD ruling — the live glob pin's Node 20 arm (CI runs Node 20, which does not glob) has not yet run ...: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
| 10 | build | SDD ruling — an interrupt during the reviewer launch writes the stop/final lines through reportInter...: ratify or reverse at the Review Console (staged/sdd-ruling-10.md) | open | — |
| 11 | build | SDD ruling — the fix launch's own usage and denial tool_input stay off the event lines — the review ...: ratify or reverse at the Review Console (staged/sdd-ruling-11.md) | open | — |
| 12 | build | SDD ruling — an empty first-worker summary yields a PR body starting `Review fix: …` — an edge of th...: ratify or reverse at the Review Console (staged/sdd-ruling-12.md) | open | — |
| 13 | build | SDD ruling — runEvidence keeps clearing shared.activeWorker in its finally even when the child survi...: ratify or reverse at the Review Console (staged/sdd-ruling-13.md) | open | — |
| 14 | build | SDD minor (deferred) — worker self-commit messages reach the branch without normalizeTitle/neutralize (partial self-commits already allowed before this unit) | deferred | Defer-reason: pre-existing-outside-diff — the final whole-branch review triaged it OK-to-defer (pre-existing behavior, not introduced by this unit); needs a backlog record decision at the Review Console |
| 15 | build | SDD minor (deferred) — a skip-worktree/assume-unchanged evidence file could let worker code rewrite the worktree copy unseen by treeDelta; HEAD still holds the red test and CI catches it on push | deferred | Defer-reason: pre-existing-outside-diff — the final whole-branch review triaged it OK-to-defer (pre-existing behavior, not introduced by this unit); needs a backlog record decision at the Review Console |
