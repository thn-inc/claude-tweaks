# Open Items — Add four Windows test-parity anti-patterns to the windows-checkout-test-parity skill

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SKILL.md:159: the claim that tests which remove `gh` from `PATH` pass on Windows was not independently re-verified by the task reviewer (it comes from #3506's fix) | deferred | Controller checked: the gh-absent tests in `pr-state.test.js` (lines 77, 304, 385, 493) run unskipped, consistent with the claim; only a Windows dispatch can confirm the pass |
