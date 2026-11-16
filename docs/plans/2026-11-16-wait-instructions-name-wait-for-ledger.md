# Open Items — Wait instructions name wait-for.js instead of sleep 20, and a parked record measures the result after 30 days

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 3 committed on focused tests while the affected-set verify sat in the suite-slot queue: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — Whole-branch review dispatched while the post-catch-up verify waited for a suite slot: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — Controller's own queued post-catch-up verify stopped before it got a slot: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | M4 the M2 re-wrap left short orphan lines (core, task-prompt.md item 7, context-handoff.md template) instead of reflowing | fixed | Fixed in 22833269a (final-review fix wave, word-neutral reflow); scoped re-review ADDRESSED |
| 5 | build | M5 AC3.2 anchor asserted one sleep 30 in pr-first-merge.md where the AC says two lines | fixed | Fixed in 22833269a (tests/foreground-execution-instruction.test.js counts exactly two, with a go-red control); scoped re-review ADDRESSED |
| 6 | build | M6 bounded polling inherited returns within 150 seconds but a ci call can take up to 170 s | fixed | Fixed in 22833269a (core bounded-polling paragraph adds that a ci call may run 20 s past --max-seconds; reflowed in e2338339b); scoped re-review ADDRESSED |
| 7 | build | M7 journeys 4557:13 and 5280:13 read 20-minute wait-for.js wait bound (20 minutes), a redundant parenthetical | fixed | Fixed in 22833269a (parenthetical dropped in both journeys); scoped re-review ADDRESSED |
