# Open Items — build / PR-checklist canonical phase rows (#2877)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight: the new worktree branched from local main bec288319, a foreign unpushed reconcile commit not on origin/main | fixed | Worktree branch reset to origin/main 33ef34748 before the materialize commit; local main left untouched for its owning session |
| 2 | build | SDD Task 1 minor (deferred): `_shared/pr-early-run-lifecycle.md`'s #1712 all-backend creation-time `polish`-row omission (also restated in `flow/steps-and-gates.md`'s phase-exit paragraph and `flow/multispec-pr-checklist.md`, pinned by five tests in `tests/pr-early-run-lifecycle.test.js`) has no implementation — `composePrEarlyBody` has never omitted the row since #2997, no caller passed a narrowed list, and the `phases` param this run removed was never its hook | open | Outside #2877's AC (step-list scoping only). Needs a design choice: wire a boolean `omitPolish` through `compose-pr-body.js` from the run's `surface:` facets, or retire the creation-time rule in favor of would-be-exit removal. File a follow-up record at wrap-up |
