# Open Items — blast-radius isTestPath classifies shipped skill prose under skills/test/ as test files (#3680)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | blast-radius.js header comment above TEST_PATH_RE (lines 8-21) lists test-path conventions but not the prompt-prose exemption (documented at the PROMPT_PROSE_DIRS block instead) | deferred | Origin: SDD task review Minor, #3680 Task 1. Files: plugin/bin/lib/issues/blast-radius.js. Trigger: next edit to blast-radius.js's test-path conventions. |
| 2 | build | initiative-budget.js:33 has its own isTestPath that also matches skills/test/*.md | deferred | Origin: SDD task review Minor, #3680 Task 1. Files: plugin/bin/lib/issues/initiative-budget.js. Trigger: if auto-repair ever needs to touch skills/test prose. Classifying it as test excludes it from auto-repair, which is the conservative direction, so no change today. |
