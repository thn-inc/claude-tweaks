# Open Items — #3504: Converge caller-only flags out of argument-hint corpus-wide

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Task 1 minor: the corpus inverse test had no live offender until Tasks 2-3 landed; synthetic pairs assert `markedHintFlags` only | accepted | Whole-branch review triage: resolved — reverting each of the five migrated hints turns the inverse check red naming that skill; the message is covered by the AC2.1 go-red test |
| 2 | build | SDD Task 3 minor: `tests/sweep-orchestrator.test.js` test (7) does not separately pin the `--chained (producer-only)` marker | accepted | Whole-branch review triage: acceptable — reverting specify's hint makes the corpus inverse check name `--chained` |
| 3 | build | SDD Task 4 minor: `docs/journeys/document-a-flag-a-person-never-types-2964.md:44` says marking needs no hint edit | accepted | Whole-branch review triage: not a defect — the journey's entry point (line 12) is the forward-check failure where the flag is by definition absent from the hint; the already-in-hint case is covered by line 36 |
| 4 | build | SDD Task 4 minor: the AC3 test is a plain `includes` check with no mutated-copy control | accepted | Whole-branch review triage: accept as is — the pre-edit RED run is the go-red evidence; a mutation control adds little |
| 5 | build | SDD final re-review minor: the plan file's Global Constraints line still quotes backlog's old `--source <human\|routine\|sweep>` hint | accepted | Historical plan record of the authoring-time state; the plan file is deleted at wrap-up plan cleanup |
| 6 | build | SDD ruling — fold all 3 final-review minors into the one fix wave, including dropping `sweep` from backlog's `--source` hint value: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 7 | review/code | Lens 3c (low): the corpus inverse loop in `tests/argument-hint-input.test.js` had no floor on marked entries, so a parser regression could pass it vacuously | fixed | Added the marked-entry floor test in 6204a1743; red under a neutralised EXEMPT_MARKERS mutant |
