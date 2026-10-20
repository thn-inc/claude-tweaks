# Open Items — #3772 Review Console keeps an unconfirmed finding pending after the same run confirmed it, and lists staged items whose files are gone

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Low-tier `confirmed via direct verification (source read independently)` AUTO line (review/step3-lens-dispatch.md:50) has lowercase `confirmed` and no `Confirmed` sentence, so a STAGED-then-low-tier-override sequence would not supersede (0 occurrences in real data — the two are alternative outcomes) | deferred | — |
| 2 | build | `findingKey` keys on the first `path:line` only — a STAGED line naming two locations is superseded by a confirmation of the first (real two-location low-confidence lines are same-substance) | deferred | — |
| 3 | build | Lens regex also matches `Cross-lens corroboration/debate` wording (yields an uncollidable `corroboration\|…` key; harmless today) | deferred | — |
| 4 | build | The `not counted —` residue line is unbounded for many missing items (7 missing items in all history) | deferred | — |
| 5 | build | `console-resolve.js --json` `unresolved` still includes missing items (only reachable on a fresh resolve, where staged files exist by construction) | deferred | — |
| 6 | build | SDD ruling — residue.test.js's `formatResidueLines names every item…` reflect-1.md assertion changed because Deliverable 2 replaces that exact behavior; all other fixtures fixed by adding staged files: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 7 | build | SDD ruling — AC4.1 applies to tests pinning the new behavior; guard tests (AC2.1, different-lens, AUTO-before-STAGED, not-confirmed) cannot go red with the fix reverted by construction: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 8 | build | SDD ruling — plan Task 3 (AC4.1) satisfied by recorded red/green evidence (Task 1 pre-implementation RED; Task 2 and final reviewers' scratch-worktree reverts) instead of a separate dispatch: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 9 | build | Follow-up (pre-existing, out of scope): decisions.md `share a location but not substance … both staged` STAGED lines match neither the Low-confidence nor Contested regex in `coordinationItems`, so they produce no console item at all (6 real lines, e.g. archive 2026-10-17T192303-spec-3412 lines 50, 52, 64) | open | — |
| 10 | build | Follow-up (pre-existing, out of scope): `coordinationItems` ids are `decision:` + `line.slice(2, 60)`, so distinct STAGED lines sharing the first 58 chars collide on one console id | open | — |
