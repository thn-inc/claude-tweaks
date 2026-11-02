# Open Items — Pin the below-floor parent-close skip rules across the prose gate and its Node mirror

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Go-red controls in the #4800 block fail alongside the main test when the live Step 4.0b prose drifts (task review, Minor) | accepted | Intentional: the controls run on live prose so they cannot go stale; the extra red lines are noise on an already-red run, not a defect |
| 2 | build | The `note` field on the #4800 table's no-reason rows is read by no code (task review, Minor) | accepted | Intentional: it states each row's disposition for the reader, the same job a trailing comment would do |
| 3 | build | Remaining detection limit: a Step 4.0b rule stated outside the routing paragraph and without a skip word is not caught by the #4800 test (re-review) | observation | Stated in the test block's comment; the routing paragraph is where the file lists its rules |
| 4 | build | SDD ruling — fix the plan's two detection gaps rather than park them: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
