# Open Items — Digest rollover drops live entries from clustering, expiry and dedup

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — plan corrected on four points of the rollover second generation and readers: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | `tests/materiality-floor-conformance.test.js:503` pins only the head of the orphan sentence: deleting ", as its `{old}` or its `replacement`" stays green | open | Meets fix-now; for /review's fix round, past SDD's dispatch cap |
| 3 | build | `tests/materiality-floor-conformance.test.js:561,564`: the helper's comment and error text say "a line that starts with `lead`", but the Expiry lead now sits mid-line | open | Meets fix-now; for /review's fix round, past SDD's dispatch cap |
| 4 | build | digest-sweep.md's Expiry fence has no test for its CRLF split or `String(c.body)` coercion: both mutants survive, and web-UI comments can carry CRLF | open | Meets fix-now; for /review's fix round, past SDD's dispatch cap |
