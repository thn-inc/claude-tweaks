# Open Items — Windows: tests expect native paths where git prints forward-slash paths (#3064 calibration class)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Task review minor: the porcelain-parse chain repeats in `tests/run-integrity.test.js` and `tests/teardown-gate.test.js` (and `tests/bin-lib/verify/cli.test.js` from #4222) | observation | Code stands: the reviewer proposed no change and called a shared helper premature; the brief prescribed this shape. |
| 2 | build | Task review minor: suffix matching in `tests/bin-lib/verify/baseline.test.js` is weaker than the old exact `includes` | observation | Code stands: the spec mandates taking the porcelain entry by fixture-directory suffix, and the suffix is a random `mkdtemp` name, so a false match is not realistic. |
