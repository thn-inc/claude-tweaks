# Open Items — Windows regression-proof 9 prose tests that split or index raw-read markdown on '\n\n'

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | New CRLF tests use crlfCheckoutRead + the suite's extractor, never the suite's own module-level read, so a reverted read swap stays green; proof of the swap rests on the windows-regression dispatch (plan-mandated) | deferred | |
| 2 | build | Four-assertion CRLF guard preamble duplicated across nine tests (plan-mandated shape) | deferred | |
| 3 | build | Ruling: Tasks 1-3 dispatched as one batched implementer with one task review — plan header is batched and the three tasks are the same edit shape — cost if wrong: a larger combined diff, mitigated by the whole-branch review | observation | |
| 4 | build | Ruling: tests/blast-radius-snippet.test.js:17-18 (a regex containing \n\n over a raw read, outside this record's sweep grep) left to open record #3670, whose body names that file and line; PR body names the gap — cost if wrong: AC1's wording stays unmet for that one file until #3670 ships | observation | |
| 5 | build | Ruling: final-review minors 1 (non-discriminating CRLF tests) and 2 (duplicated preamble) parked as plan-mandated; reviewer's CRLF simulation showed base fail 10 -> head fail 1 (the #3670 file) — cost if wrong: a later revert of one swap goes unnoticed until the post-merge Windows run | observation | |
| 6 | build | Ruling: final-review minors 3 (helper comment overstated) and 4 (two weak assertions) fixed in one fix wave (67609afd9), re-review all addressed | observation | |
| 7 | test | windows-regression run 39352551447 (windows-latest, this branch at 10f270f54): tests/try-it-contract-conformance.test.js test 3 "the Try it field lines live in exactly one skill file" fails on win32 — path.relative display ID '_shared\\try-it.md' vs expected '_shared/try-it.md' (toPosix missing at the test's producer). Pre-existing, unrelated to '\n\n'; this record's CRLF test in that file (ok 18) passes on Windows. Route via /claude-tweaks:capture (Defer-reason: pre-existing-outside-diff) | open | |
