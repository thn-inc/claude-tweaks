# Open Items — #3066: Refuse a flaky retry when spec-reporter failures cannot all be attributed to a file

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | review | `unattributedFailureCount`'s TAP branch (extract.js:505) returned early without checking that summary counts parsed, unlike the spec branch — a truncated TAP log could read as fully accounted (high; 3a-A/3a-B/3b-B/3c-B, confirmed via direct-verification override against baseline.js's `adjudicate`) | fixed | commit 026bca0f7 — extended the counts/cancelled/entries cross-check to TAP |
| 2 | review | No integration-level test exercised `verify.js`'s real retryHook wiring end-to-end; reverting the 4-line wiring left the suite green (high; 3f-A) | fixed | commit 026bca0f7 — added a `cli.test.js` case through the real CLI, discrimination-verified |
| 3 | review | `retryDecision.reason === 'unattributed-failures'` has no documented agent dispatch path in `test/verification.md`'s Flake handling section (medium; 3a-B) | fixed | commit 026bca0f7 — documented + pinning test updated |
| 4 | review | `flaky.js`'s `unattributed-failures` reason drops the count, unlike its sibling `unlisted: […]` reason (low; 3b-B/3c-B) | fixed | commit 026bca0f7 — now `unattributed-failures: {N}` |
| 5 | review | Test name in `extract.test.js` claimed "0 for TAP" while asserting 1 (medium; 3f-B) | fixed | commit 026bca0f7 — renamed with accurate comment |
| 6 | review | Missing test coverage for the pre-existing spec `cancelled > 0` and counts-null fail-closed branches (low; 3f-B) | fixed | commit 026bca0f7 — added both |
| 7 | review | `unattributedFailureCount` omits the `RUNNER_ERROR_RE` check baseline.js's `accountedFamily` applies (high; 3c-A, single-agent) | accepted | Investigated via direct verification — not confirmed: `adjudicate()` (the function #3066's spec text actually cites) never checks `RUNNER_ERROR_RE` either; only the separate `accountedFamily()` does. Comment corrected in commit 026bca0f7 to cite only `adjudicate`. See decisions.md. |
