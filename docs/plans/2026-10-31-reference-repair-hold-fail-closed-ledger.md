# Open Items — Reference-repair hold fails open when the agent-written Held: marker is missing or misplaced (#4636)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead (7c3fa514f release 6.157.2) (reason-not-auto: requires-judgment — rebase vs continue) | fixed | Post-creation catch-up merged origin/main into the worktree branch — `dbd0ce4a7` |
| 2 | ops | Pre-flight branch-divergence-check (run 2026-11-03T082956): origin/main was 2 commits ahead (3ebed678f) (reason-not-auto: requires-judgment — rebase vs continue) | fixed | Post-creation catch-up merged origin/main into the worktree branch — `6f436e6b4` |
| 3 | build | SDD ruling — permittedInitiative holds an unreadable sensitivePaths; the sweep passes an array: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — case-folded merge-sensitive match here; shared blast-radius.js matcher deferred: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | build | SDD ruling — Task 2 fix-now Minors folded into fix round 1: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 6 | build | SDD ruling — the parser refuses mode lines; the recipe copies b/ with cp -p: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 7 | build | SDD ruling — Task 3 Minors fixed in fix round 1: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 8 | build | SDD ruling — untested parser backslash-line check pinned via Task 4: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 9 | build | SDD ruling — final review residual fixed by one targeted dispatch: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 10 | build | `isSensitivePath` matches less than the deleted `matchesPath` for undocumented glob forms (`a**b`, a `/**` not at the end, `?`) — Ruling: code stands; using the merge-check floor's own matcher exactly is the plan's intent and none of these forms is a documented `merge-sensitive-paths` form — costs a missed hold on such an undocumented glob if wrong | observation | Parked at Task 1 review; the final review triaged it as leave |
| 11 | build | The multi-spec console has no drills-individually class, so a no-diff Reference repairs row approved there with Approve all always ends "not applied" (safe, fails closed; `multispec-review-console.md` has 664 B rail headroom) | deferred | Defer-reason: genuinely-larger — the final review triaged it as leave; needs its own backlog record |
| 12 | build | On a human-present console a staged diff that already has one gets no floor re-run, so an Approve all can land a test-file hit the human never saw (within the plan: Review Focus 15 covers auto-resolved rows only) | deferred | Defer-reason: needs-human-decision — the final review triaged it as leave; needs its own backlog record |
