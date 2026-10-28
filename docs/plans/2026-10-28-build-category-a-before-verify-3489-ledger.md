# Open Items — Build Step 5.5 Category A fixes still land after the final verification (#3489)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — implementers ran targeted tests only; full suite runs once at Common Step 5: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — Task 1 review Minors 1-3 fixed in this build (inline triggers, second go-red, heading guard): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — no change for SKIP-condition wording (accurate by construction) and plan go-red note: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — Task 1 re-review Minors fixed as round 2 (row-count sentinel, Category B guard): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — Tasks 2 and 3 batched into one implementer and one review: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — Tasks 2-3 review Minors fixed (journey re-check sentence, stale hedge): ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build | SDD ruling — final-review Minors and the row-count deferred minor fixed in one fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 8 | build | SDD ruling — journey step 2 repetition minor closed as no action: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 9 | review/convention | SKILL.md:295 Step 5 named operational-checklist.md but gave no read directive (commit dedcb7b6a) | fixed | Step 5 now reads the Category A section before applying |
| 10 | review/error | SKILL.md:295 and operational-checklist.md:22 no outcome for a Category A action that fails or cannot complete (commit dedcb7b6a) | fixed | failure sentence in Step 5; ledger `fixed` only once the action completed |
| 11 | review/error | SKILL.md:305 Step 5.5 entry depended on agent memory of a Step 5 fix (commit dedcb7b6a) | fixed | Category A commit subject plus git log entry condition |
| 12 | review/test | SKILL.md:295 and :303 timing word, paragraph order and Step 5.5 not applying Category A unpinned (commit dedcb7b6a) | fixed | assertions plus two go-red tests |
| 13 | review/security | operational-checklist.md:17 schema push now precedes verification | accepted | spec Deliverable (a) places it there; re-check clause re-applies the push; failure sentence covers a failed push |
| 14 | review | Low and info findings: keep-or-trim of the Step 5 re-check (kept), trigger restatement, plugin-structure.md:101 wording, checklist cell wording unpinned | accepted | tiebreak recommended drop; reasons in decisions.md Step 3 Routing |
