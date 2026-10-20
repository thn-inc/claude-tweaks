# Open Items — #3711 wrap-up Dispatch-claim branch matches every human-run /flow

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Pre-flight divergence: origin/main was 5 commits ahead of local main at /flow Step 2.5 (auto continued) | observation | Closed by the post-creation catch-up merge (worktree advanced d170e1b4e → 034bda4fb) |
| 2 | build | SDD Task 1 minor: reader test never feeds a non-plain-object run-state.json ([] / "x") | accepted | Final whole-branch review triage: leave — the reader passes readRunState's output straight through and the predicate table covers [] and a string |
| 3 | build | SDD Task 1 minor: redundant try/catch in isDispatchTaskCallForRun (readRunState already swallows) | accepted | Final whole-branch review triage: leave — harmless never-throws insurance the spec asks for |
| 4 | build | SDD Task 2 minor: widened "composer exits non-zero / merge conflicts / branch guard aborts" paragraph's close-run residual is local-merge-only but unscoped | fixed | Scoped to "under `local-merge`" in the final fix wave — 620f95790 |
| 5 | build | SDD Task 2 minor: AC6.2 pin uses /i (prose starts "Any other output") | accepted | Final whole-branch review triage: leave — the go-red guard uses the same flag |
| 6 | build | SDD ruling — frozen PRE_CHANGE / PRE_CHANGE_EXCERPT constants quoting the old heading stay byte-identical: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 7 | build | SDD ruling — tests/ grep returns 8 dispatch-claim lines, not the brief's 2 (extra 6 are Task 2's frozen excerpts + one negative assertion): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 8 | build | SDD ruling — scope widened to plugin/bin/hooks.js: record-worktree --dispatch stamps dispatchSessionId, predicate falls back to sessionId when absent: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 9 | build | SDD ruling — Routine-context session-id sharing left unverified, recorded in the PR description: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 10 | build | Final review (parked): sessionId fallback in task-call.js has no recorded removal condition (CLAUDE.md expand-contract rule) | fixed | Inline removal condition (grep predicate + 6-month release grace) in plugin/bin/lib/dispatch/task-call.js header — Common Step 4.5 commit |
| 11 | build | Final review (parked): tests/hooks-dispatcher.test.js #3225 test title still ends "plus dispatched" | fixed | Title now names dispatchSessionId — Common Step 4.5 commit |
| 12 | build | Final review (parked): spec/plan text still describes a sessionId-only match; the dispatchSessionId scope-widening lives only in rulings | observation | Recorded in the PR description at the pre-merge refresh; the materialized spec is an audit snapshot and is not rewritten |
