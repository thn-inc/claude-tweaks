# Open Items — Keep both PR-body delimiter forms through an MCP read-repair-write

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Task 1 minor express Phases append | observation | SDD parked — Ruling: leave; no production path hands an express body to repairPrBody (express-lane.md composes with compose-pr-body.js --express and skips the checklist refresh) and it is outside #5358's Deliverable; logged to the digest below the materiality floor — if wrong, a future caller repairing an express body adds a stray Phases block, exactly as before this record |
| 2 | build | Task 2 minor retyped whole-piece names in pr-checklist.js | observation | SDD parked — Ruling: leave; the extended `carried none` test goes red on any rename in pr-body.js, and the prose path restates the names anyway — if wrong, a rename needs two edits instead of one |
| 3 | build | observation: adopted MCP-stripped body is not healed until the next phase exit (pr-early-open.js) | observation | SDD parked — Ruling: leave; the next phase exit's pr-checklist refresh heals it, github-pr-scan readers skip drafts, and writing on adoption adds a new PR write path outside the Deliverable — if wrong, a draft PR lacks HTML markers for at most one phase |
| 4 | build | observation: gh-absent MCP path logs a restore on every phase exit | observation | SDD parked — Ruling: leave; the line is accurate and phase exits already log routine AUTO lines — if wrong, one extra decisions.md line per phase on cloud runs |
| 5 | build | SDD ruling — AC1.1 express half asserts startsWith(express), not byte-exact: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
