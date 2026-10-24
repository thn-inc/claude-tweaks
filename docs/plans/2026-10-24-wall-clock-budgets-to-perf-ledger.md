# Open Items — Move the 12 pinned wall-clock budgets from tests/ to perf/

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow/ops | Pre-flight branch-divergence check: origin/main was 2 commits ahead of the dispatched worktree branch | observation | Caught up by the post-creation catch-up merge (d47cd98 → 13cabe9) before any build commit |
| 2 | build | SDD ruling — implementers ran only their focused suites; the full suite runs once centrally at /build Common Step 5: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — Tasks 2-4 (same-shape pure relocations) batched into one implementer dispatch, one commit per task, one review: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — all final-review findings (2 Important, 4 Minor) fixed in one fix dispatch: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | Task 1 minor: perf/scale-readiness-linearity header cited #3412; perf fixture temp dirs not removed | accepted | Citation fixed to #2622 in 1de1777f8; temp dirs left behind match existing perf/ practice (closing-keyword-linearity does the same) — final-review triage |
| 6 | build | Tasks 2-4 minor: tests/ titles (dream/scan, gif/palette) still promised speed; perf/premise-self-check-timeout temp dir not removed | accepted | Titles retitled in 1de1777f8 (with reconcile, scale-readiness, session-failures titles); temp dir matches the original test — final-review triage |
| 7 | build | Task 8 minor: MOVED_TO_PERF has no completeness check against future moved budgets | accepted | Outside the brief; a future moved budget has no obligation to join a #3939-specific map, and the journey now names the floor — final-review triage |
