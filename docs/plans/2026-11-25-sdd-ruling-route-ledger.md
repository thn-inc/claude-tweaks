# Open Items — Route procedural SDD rulings to an audit line instead of a ratify/reverse Review Console row

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 1 review Minor (export SDD_RULING_ROUTES constants like the module's sibling classifiers) is folded into Task 2's implementer brief, where the CLI is the first consumer: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — Task 2 re-review Minor (empty --file test asserts only stderr non-empty) needs no change: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — Task 4 (AC3 archive replay) run by the controller, not dispatched: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — Task 3 review Minor 5 ({line file} placeholder has no stated location) needs no change: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — Task 3 re-review Minor (a decision line that succeeded before a failed ledger-row leaves an 'AUTO ... not staged' line for a ruling the fallback then stages) is accepted as written: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — residual Minor (CLI's argv[0] !== '--file' clause has no test that goes red when it is removed) is fixed in this build with one targeted test-only dispatch plus one scoped re-review, as /build authorizes for a residual after the fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build/skill | gh-api-module-pattern cli-wrapper-contract.md: plugin/bin/sdd-ruling-route.js joined the Payload-1/Invocation-2 exit family (1 unreadable --file, 2 malformed) but the family's member list does not name it yet (extends the skill's exit-family roster) | open | — |
