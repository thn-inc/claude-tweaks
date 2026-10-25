# Open Items — wrap-up review-console: skip test:true gate-denial events when reading events.jsonl (#4186)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/verification | Real-input probe: main checkout's archived runs hold 882 `gate-denial` events and zero carrying `test: true` (no archived `events.jsonl` line has a `test` field at all), so this fix changes no real calibration number today; some untagged denials name tmp/scratchpad test paths — possibly test-suite hook runs that never set `CT_HOOKS_TEST_MODE`, unverified. Decide at wrap-up: capture a follow-up to investigate the untagged population, or drop as speculative. | open | — |
