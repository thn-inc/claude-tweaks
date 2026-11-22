# Open Items — Reuse a valid specify-time plan in /build and skip Spec Step 3 and plan review

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 13 commits ahead of local HEAD at Step 2.5 (reason-not-auto: informational) | observation | Worktree post-creation catch-up merged origin/main (6adac5c to 834d68e) before any build commit. |
| 2 | build | SDD ruling — Important #1 (plan-mandated) — {spec} is the worktree's committed materialize file .cla...: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — Important #1 (plan-mandated) — the stale-plan route must not re-enter plan-reuse.md for...: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Important #2 (plan-mandated) — Common Step 1.6 stub's standalone clause is reworded to ...: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — minor #4 — template.changed: true is a precondition that skips reuse (SKIP 'condition: ...: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — the residual Important is real and AC-covered (AC1.1) — not deferred; one targeted fix ...: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | the template-ordering pin's permutation control exercises only its after-absent assertion; its after-## Probe and before-## Checks assertions have no go-red control of their own (tests/build-plan-reuse-conformance.test.js:210) | deferred | Defer-reason: needs-human-decision — passes fix-now; only the closed SDD fix wave stops it (deferral-gate derivation) |
