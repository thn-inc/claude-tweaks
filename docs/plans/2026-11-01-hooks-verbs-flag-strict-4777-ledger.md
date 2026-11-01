# Open Items — Make every hooks.js verb refuse an undeclared flag, starting with reconcile (#4777)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow/ops | Pre-flight branch-divergence-check: origin/main was 8 commits ahead of local main (Step 2.5, auto-continued) | fixed | Post-creation catch-up merged origin/main c1495d026 into the worktree (9685e20af); worktree tree equals origin/main |
| 2 | build | SDD ruling — Task 2 audit evidence rests on the corrected grep (the plan's \b command matched nothing); the PR body quotes the corrected command: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — final-review Important 2 (stale journey step 4 in recover-from-a-mistyped-hooks-js-verb-4181.md) routed to /build Common Step 6 (journeys), fixed in this build: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — residual KNOWN_FLAGS comment (--help/-h "fall out as unknown") fixed with one targeted dispatch after the final fix wave (e1fb50443): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD minor (deferred) — tests/reconcile.test.js prints empty-clone / non-fast-forward git noise to stderr during its runs (Defer-reason: pre-existing-outside-diff) | deferred | — |
| 6 | build | SDD minor (deferred) — unknown-flag refusals exit 0 (spec-mandated), so `RUN_ROOT=$(... resolve-run-dir --root-only) \|\| exit 1` callers cannot stop on a mistyped flag; whether refusals should exit non-zero is a contract decision (Defer-reason: needs-human-decision) | deferred | — |
| 7 | build | SDD parked — the check-* verbs (check-resume-freshness, check-staged-inventory, check-session-residue) have no declared-flag positive control; check-sibling-sessions gained one in the final fix wave (05bc92591) | observation | — |
