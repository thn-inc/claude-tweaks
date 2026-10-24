# Open Items — review: Step 2.5 record-label read writes {ctx-dir}/record-{n}.json by hand, failing in worktree-isolated sessions

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | prose.test.js:114 redirect regex does not catch a > redirect to $CTX_DIR/ or "${CTX_DIR}/" (record-{n}.json assertion covers this filename) | fixed | Redirect pin widened to also match `> "$CTX_DIR/…"` and `> ${CTX_DIR}/…` (1186f1ede); prose.test.js 14/14 pass, regex probed on 4 sample strings. SDD task-review minor; origin: Task 1 review |
| 2 | build | QUOTED_FLOOR=63 margin unmeasured after the two quoted record-{n}.json sites were removed (suite still passes) | accepted | Measured at wrap-up: scanCorpus().quoted = 63 = QUOTED_FLOOR (spans 17 = SPAN_QUOTED_FLOOR), so the floor is exactly tight and there is no margin to lower; no edit. SDD task-review minor; origin: Task 1 review |
| 3 | build | SDD ruling — Step 3's conditional QUOTED_FLOOR edit may touch a file outside Task 1's Files: block: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | wrap-up | pr — PR #4017 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
| 5 | wrap-up | suite — project suite not re-run by the residue probe (skipped via --no-suite); state taken from the runner stamp: full pass at f18a6857f, 15659 tests, 0 failures | observation | — |
