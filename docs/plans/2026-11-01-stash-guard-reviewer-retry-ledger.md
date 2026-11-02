# Open Items — Move the stash-guard reviewer-retry logic out of build/dispatch.md (#4785)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — split the stash-guard carry-over out of the reviewer paragraph behind an every-dispatch lead-in: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — keep the stash-guard stanza's dropped rationale clauses and session-tmp-root cite out (2,000-byte pin): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — retitle stash-guard.md to Non-Zero Exit Outcomes against the plan's heading: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build/skill | prose-code-twin-pin: extends its pattern. Skill prose documents a CLI's log-line template plus its {who} form list (build/stash-guard.md), and tests/stash-guard.test.js pins both against the CLI's real emitted decisions.md lines across every dispatch-id shape, not only a table against an enum | observation | — |
| 5 | review/3f | The stanza's snapshot and compare commands were pinned only through their prefix, so a dropped --out, --baseline or --run (which silently loses the logged restore) stayed green (medium, repro-confirmed) | fixed | Whole argument lists pinned in the AC6.1 facts (a49201a61) |
| 6 | review/3f | The dispatch-id derivation, the id forms, the other dispatch labels and the standalone omit rule were unpinned (low, repro-confirmed) | fixed | Four stanza facts added (a49201a61) |
| 7 | review/3f | The never-upgrades clause and the carry-forward to the next review or re-dispatch were unpinned (low, tiebreak confirmed) | fixed | Three outcomes facts added (a49201a61) |
| 8 | review/3f | The standalone else-branch snapshot path via session-tmp-resolve.js was unpinned (low, tiebreak confirmed) | fixed | Stanza fact added (a49201a61) |
| 9 | review/3f | The exit-2 standalone destination (the handoff's Skipped steps) was unpinned (low, tiebreak confirmed) | fixed | Outcomes fact added (a49201a61) |
| 10 | review/3f | The retry's fresh snapshot/compare pair (role {role}-retry) and its second dirty-note form were unpinned (low, tiebreak console/digest on unverifiable evidence) | fixed | Two outcomes facts added in the same wave (a49201a61), so no console row or digest entry is owed |
| 11 | review/3a,3c,3f | Ten further findings the tiebreaks refuted or rated info/drop: pointer path form, pointer timing, local escapeRe, reviewerBranch empty on a lost anchor, failed lazy read, unpinned --run on two log-decision calls, six-phrase denylist, singular-only twin pin, AC3.1 in a test name, stale Revert 2e log line | accepted | Each with its tiebreak reason in decisions.md (Step 3 Routing (accepted)); none worth a fix or a record |
| 12 | wrap-up | pr — PR #4888 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
| 13 | wrap-up | suite — skipped via --no-suite in the residue pack; suite state comes from the verify pass stamp at HEAD c342ed4bf (scoped: tests 8451 pass, journeys 79 pass, 0 fail) and CI test check SUCCESS on the same head | observation | — |
