# Open Items — #3519 Scratch-path instruction tells worktree-isolated lens agents to use a heredoc

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Ruling: the canonical fragment is the plan's Global Constraints text with the backslashes before backticks removed (literal backticks, em dash, semicolon), given to the implementer as task-1-fragment.txt. Cost if wrong: four sentences and one test constant to reword. | observation | SDD pre-flight ruling (plan's markdown code span could not escape backticks) |
| 2 | build | Ruling: contract:39's added `_shared/scratch-worktree.md` §7 pointer and "— and never" connector are intended per plan Step 3. Cost if wrong: one clause reworded. | observation | SDD ruling on implementer concern |
| 3 | build | step3-lens-dispatch.md:82 comma splice: the fragment ends "refuses by shape" then ", never `Write`/`Edit`**", which reads as if the guard refuses Write/Edit by shape. Use "; never" or " — never". | deferred | — |
| 4 | build | Go-red control in tests/subagent-contract-clauses.test.js throws on the count assertion first, so the two `doesNotMatch` old-wording guards are not shown independently able to go red. | deferred | — |
