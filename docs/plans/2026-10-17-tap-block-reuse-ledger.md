# Open Items — #3404: Reuse verify's TAP block parsing in the Windows regression filer

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | new tapLines tests do not pin keyStart:false + key carried on a YAML continuation line (covered indirectly via tapBlocks keys) — final review triage: leave | deferred | — |
| 2 | build | tapLines indent on a whitespace-only line is the whole line length (unconstrained; the filer reads indent only on ok/notOk lines) — final review triage: leave | deferred | — |
| 3 | build | Ruling: review finding (plan-mandated, Important) — start = tap[hit].owner reopened a crashed file's stderr at the prior not-ok past its closed YAML; fix kept the ownership approach with the yamlClose rule restored (later generalized to ownerAt for hit and walk-back by the final-review fix wave, 72bf6c6d8) — cost if wrong: one extra branch in excerptFor | observation | — |
| 4 | build | crashAfter comment in tests/windows-regression-file-issue.test.js says the failed block's YAML terminator is the fallback boundary but both L21 variants add an ok/Subtest line — final review triage: leave (new regression test covers the terminator-only case) | deferred | — |
| 5 | build/skill | node-test-output-evidence extends: verify's TAP state machine is now one exported classifier (`tapLines`), and a block's ownership runs past its YAML terminator to the next test point or `# ` line (tapBlocks' body/frames include those lines) — a consumer that means "inside this failure" must stop ownership at the block's yamlClose (file-issue.js's `ownerAt`); this trap bit #3404's plan and first implementation twice | observation | — |
