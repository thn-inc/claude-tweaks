# Open Items — phase-timing's locateTranscripts ignores CLAUDE_CONFIG_DIR (#3458)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | transcript.js:44 locateTranscripts signature is ~150 chars on one line (plan-mandated default-param form) | deferred | Origin: SDD Task 1 review minor (cf9d732a7). Files: plugin/bin/lib/timing/transcript.js. Trigger: next edit to locateTranscripts. |
| 2 | build | transcript.js:59 header {config-dir} note line much longer than its 80-col neighbours — could be wrapped | deferred | Origin: SDD Task 1 review minor (cf9d732a7). Files: plugin/bin/lib/timing/transcript.js. Trigger: next edit to the TRANSCRIPT_SLUG_RULE header. |
| 3 | build | transcript.test.js test titles at :61/:71/:79 still say ~/.claude/projects (accurate for the default path; reviewer recommends leaving) | deferred | Origin: SDD Task 1 review minor (cf9d732a7). Files: tests/bin-lib/timing/transcript.test.js. Trigger: a test there that exercises a non-default root under that title. |
| 4 | build | transcript.test.js:249-255 withEnv is synchronous-only; a future async caller would restore env early | deferred | Origin: SDD Task 1 review minor (cf9d732a7). Files: tests/bin-lib/timing/transcript.test.js. Trigger: first async use of withEnv. |
| 5 | build | Item 2's over-long transcript.js header comment line was wrapped by Common Step 3's simplifier pass (supersedes item 2) | fixed | plugin/bin/lib/timing/transcript.js header — commit "Wrap transcript.js config-dir header note" (Common Step 3). |
