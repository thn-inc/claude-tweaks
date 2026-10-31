# Open Items — Catch the run branch up with the integration branch before build's final verification, not after it

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — fix Task 1's five task-review Minors now rather than defer: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — fix Task 2's three task-review Minors now rather than defer: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — fix final-review Minors 1, 2, 5, 6 in the fix wave (procedure moved to _shared/pre-verification-catchup.md): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — two targeted residual fixes after the final fix wave's re-review: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — multi-spec runs skip the pre-verification catch-up (boundary-freshness HARD-GATE over AC1's any-run-mode wording): apply or decline at the Review Console (staged/build-deviation-1.md) | open | — |
| 6 | build | nit: no `marker missing: --step …` control for the conformance suite's first requireOrder marker | observation | Ruling: the needle's deletion is already caught by the per-fact missingFacts loop, so the content is pinned; no change |
| 7 | build | out-of-scope: git-discipline.md lines 201-202 and 239 run 100-105 columns | observation | Ruling: cosmetic only (needles match collapsed text), pre-existing or code-span lines; no change |
| 8 | build | final review Minor #3: the "already current" SKIP vs the degrade-trace rule's "never log ran fine" | observation | Ruling: the merge is a documented conditional action the "already contains" condition skips, which is the Degrade-trace rule's SKIP definition; spec Deliverable 2/AC4 mandate the line; no change |
| 9 | build | final review Minor #4: Catch-up step 1's porcelain test counts untracked files as dirty (unlike pre-review-catchup.md) | observation | Ruling: inherited deliberately from the cited Catch-up step 1, and the SKIP is logged so it is visible; diverging from the cited step belongs to its own record if wanted |
| 10 | build | nit: skill-graph row "an unresolved integration model, … runs log one SKIP" reads awkwardly (a model is not a run) | observation | Ruling: wording only, meaning is unambiguous; no further fix dispatch |
| 11 | build/skill | skill-prose-conformance-tests extension: prose added inside another suite's sliced region (here git-discipline.md's Post-push..Catching slice) can silently satisfy that suite's presence needles ("never rebase") and defang them — when adding text inside a region another conformance suite slices, re-prove that suite's go-red controls or keep the new text outside the slice | observation | — |
