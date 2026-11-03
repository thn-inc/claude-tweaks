# Open Items — Make the test-suite slot in tools/run-tests.js FIFO so a queued run cannot starve

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow/ops | Pre-flight branch-divergence check: origin/main was 20 commits ahead of the branch at run start | fixed | Post-creation catch-up merged origin/main into the branch at 284438123 |
| 2 | build | withWaiters (tests/run-tests-isolation.test.js) listens only to the child 'exit' event; a spawn 'error' (practically unreachable with process.execPath) would wait out the 10 s cleanup bound instead of failing fast — test-diagnostics only, no product behaviour | observation | Carried from the SDD final fix wave's scoped re-review (out-of-scope observation) |
