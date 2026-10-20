# Open Items — Quote the runner-printed file path in the flaky-retry command

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Untested refusal branches in file-template.js: win32 `"`/`!` path refusals, rule order (control-character before cmd-unquotable), multi-`{file}` template | deferred | Origin: SDD Task 1 review (minor). Files: tests/bin-lib/verify/file-template.test.js. Trigger: the next change to file-template.js's refusal rules. |
| 2 | build | Real-sh test left its mkdtemp dir behind | fixed | 6015ac661 (try/finally rmSync) |
| 3 | build | A plain path starting with `-` substitutes unquoted and can read as a runner option (argv flag injection, outside the shell-metacharacter AC) | deferred | Origin: SDD Task 1 review + final review (minor). Files: plugin/bin/lib/verify/file-template.js. Trigger: backlog record for argv-option injection through `{file}` (e.g. `./`-prefix or refuse a leading `-`). |
| 4 | build | No pin for a mixed plain+unsafe list refusing whole, or max-retries-0 outranking unsafe-path | fixed | 798ae581a (two pins in flaky.test.js) |
| 5 | build | unsafe-path reason named files but not why; sub-reason only in plan.unsafe | fixed | 798ae581a (`unsafe-path: [file (reason)]`) |
| 6 | build | No baseline test pinned a quotable spaced path reaching runOne as the quoted command | fixed | 937d29660 |
| 7 | build | Refusal reasons (baseline ineligible, unsafe-path) echo the raw path, so a control-character path's bytes reach the printed reason | deferred | Origin: SDD Task 3 review (minor). Files: plugin/bin/lib/verify/baseline.js, plugin/bin/lib/verify/flaky.js. Trigger: next change to how verify.js prints reasons; mitigated today because stripAnsi runs before extraction, and the existing `unlisted:` reason already echoes raw paths. |
| 8 | build | The `\|…\|` prefix group in SUMMARY_FAIL_RE is not tied to vitest (any `\|token\|` plus whitespace after FAIL/❯/FAILED is stripped) | deferred | Origin: SDD Task 4 review (minor). Files: plugin/bin/lib/verify/extract.js. Trigger: a runner other than vitest is found printing `FAIL \|x\|`; fails safe (no retryable file, so refusal). |
