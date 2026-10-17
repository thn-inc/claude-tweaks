# Open Items — engine-verify tests: probe checks registered via registerCheck leak into every later runVerify call (#3388)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | New #3388 tail test in tests/bin-lib/wrap-up/engine-verify.test.js registers __test-dup__ and calls unregA/unregB outside try/finally — an assertion failure between them would leave __test-dup__ registered (harmless today as the file's last test) | deferred | — |
| 2 | build | engine-verify.test.js:407 parenthetical "(immediately before the AC1/AC2 fixtures)" is a position reference that can go stale now that test ordering is free | deferred | — |
