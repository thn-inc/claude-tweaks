# Open Items — Record each role's model and effort in the run manifest

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 1 commit ahead of the worktree branch | fixed | Caught up by the post-creation catch-up merge fcf0d24050 |
| 2 | build | SDD task-review minors (8, tasks 1-3): non-object output_config test; driver usage-no-model and synthetic-row tests; validRoles non-integer efforts / non-object models; empty-string role/model key; deriveRoles swallowing errors; derive failure printing no stderr line; partial-close roles freeze; worked example lacking roles | fixed | Fixed in the final-review fix wave 4533643 (F1-F7) and targeted fix e360120; scoped re-reviews ADDRESSED every item |
| 3 | build | SDD ruling — per-agent effort tally lives in roles.js, not on derive.js dispatch items: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — roles model id prefers the transcript model over the dispatch alias: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | build | SDD ruling — final fix-wave residual fixed with one targeted fix and re-review: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 6 | build/skill | driver-step-addition skill: a new driver step that launches a worker now also needs a DRIVER_STEP_ROLES entry in plugin/bin/lib/run-manifest/roles.js (manifest roles keys are a contract), which the skill's site list does not name | observation | Skill enrichment candidate for wrap-up's Skills curation row |
