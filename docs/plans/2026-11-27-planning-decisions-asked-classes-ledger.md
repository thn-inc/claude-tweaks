# Open Items — Ask only design-level, hard-to-undo and contradiction questions at plan review here (#6350)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch divergence: origin/main was 5 commits ahead of local main at run start; worktree caught up by merge | fixed | Post-creation catch-up merged origin/main into the worktree branch (0fdce3f to 3faabaa) |
| 2 | build | AC2: quote the decisions.md of the first dispatched build after merge that settles a plan-review gap outside the three classes, in a comment on #6350 | deferred | Defer-reason: blocked-external → record: staged/leftover-planning-decisions-effect.md (parked until 2026-12-11; covers the first-run quote) |
| 3 | build | Deliverable 2 / AC3: two weeks after merge, post on #6350's parent the share of dispatched builds that stopped at plan review (decisions.md plan-review stops) against 12 of 15 | deferred | Defer-reason: blocked-external → record: staged/leftover-planning-decisions-effect.md (parked until 2026-12-11; covers the two-week count) |
| 4 | wrap-up | Reflect (Friction): fast-lane skip path wording implies one plan-audit call with --bytes and --risk-proofs, which the CLI refuses | accepted | Not captured again: already tracked by open #5987; this run hit it once (one exit-2 retry) |
