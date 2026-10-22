# Open Items — Pin every standalone /test call in the review skill's step files to --source review (#3827)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — go-red count kept relative (sweepDir(REVIEW_DIR).length + 1) instead of the brief's literal 1: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — gate-table slice anchored on the ### Gate: after ## Step 1.5 (plan's bare ### Gate: hit Step 1's): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SOURCE_REVIEW rejects '--source review,' (flag followed by punctuation) | observation | Strict-direction false positive only; never occurs in the live corpus — a future author sees a loud red, not a silent pass |
| 4 | build | '\b' lets hyphenated prefixes like 'pre-run' classify as an invocation | observation | Harmless and arguably correct — pre-run still names a run |
