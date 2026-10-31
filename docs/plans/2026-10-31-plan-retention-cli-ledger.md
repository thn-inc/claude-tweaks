# Open Items — tidy: compute Step 4 plan-retention routing with a deterministic helper (#4594)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — plan-retention keeps the decline store's degrade-open read of a corrupt store.json: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — plan-retention.js leaves realDeps.today uncaught: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — residual final-review minors fixed in a second targeted round: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | the new Compute pin's doesNotMatch(PRE_CHANGE_CITATION) control at tests/tidy-plan-retention-conformance.test.js:157 passes trivially (control has no Compute bullet) — the pin's real go-red is proven by the 382a26559-revert mutation and the live-text doesNotMatch at :158; no change | observation | Parked at the final review's residual re-review: the pin is discriminating through its other two checks; no code change. |
| 5 | build/skill | gh-api-module-pattern's cli-wrapper-contract (split-transport bullet) gains a two-pass wrinkle: `plan-retention.js` reports a model-judged step's inputs as data (`citationCheck`/`citationCandidates`) and takes its result back on a re-run of the same call (`--cited`), where a partial re-run would silently mix passes — the prose must say "same call, every plan again". | observation | Enrichment candidate for /wrap-up's Skills curation row. |
