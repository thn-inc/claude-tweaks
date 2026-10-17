# Open Items — Manifesto override row says review ceiling `none` auto-applies all findings — it stages them (#3166)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Out of scope for #3166: `plugin/skills/flow/manifesto.md`'s lever-7 "Effect if approved" cell reads "`low` — LOW auto-applied, MED staged, HIGH prompts", but `review/step3-routing.md`'s ceiling table stages High at every ceiling; only Critical prompts. Same mismatch as #3166's `medium` row, in a different file | open | — |
| 2 | build | Out of scope for #3166: `plugin/skills/flow/manifesto-overrides.md`'s Override table has no `review-auto-apply-ceiling` `low` row, but `low` is a real override when the Manifesto recommends `medium` (resolved autonomy `unattended`) | open | — |
| 3 | build | Task review minor: go-red controls fail on the first assertion only; later positive assertions in assertNoneRow/assertMediumRow are not individually shown able to fail | deferred | Plain `assert.match` calls; low risk (task review, Minor) |
| 4 | build | Task review minor: override rows checked by hardcoded regex, tied to step3-routing.md only through the premise tests | deferred | Acceptable for a prose-conformance suite (task review, Minor) |
| 5 | build | Task review minor: override rows do not mention the test-removal override (stages at every ceiling) | deferred | Pre-existing; no row claims anything false (task review, Minor) |
