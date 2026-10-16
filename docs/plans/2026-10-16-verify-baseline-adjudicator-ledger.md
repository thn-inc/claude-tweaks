# Open Items — verify.js --baseline adjudicator fixes (#3153, #3156)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | test | Batch pre-flight sweep (base c223eca06, `npm test`): 11139 tests, 11131 pass, 1 fail — `tests/bin-lib/gif/*` `quantize: an adversarial high-distinct-colour-count 8-frame 1280x720 walkthrough stays bounded (#2769)`, a timing-bound test run under heavy machine load (many sibling sessions). Outside this run's diff. | observation | Pre-existing at base; cite as "Pre-existing — see ledger #1, batch pre-flight sweep" if it recurs. |
| 2 | ops | Pre-flight file-overlap: open #3189 (space-in-path extraction, already fixed by #3155/PR #3172) and #3179 (nested/long-path mis-parse) name the same `plugin/bin/lib/verify/extract.js`. Not in this run's target list. | open | — |
