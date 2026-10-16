# Open Items — build / compose-subject stderr, --scope, human-approved tag (#3028)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight: local main carried a foreign unpushed commit (bec288319) not on origin/main | fixed | Worktree branch reset to origin/main d2a26abf0 before the materialize commit; local main left untouched for its owning session |
| 2 | build | plugin/skills/_shared/github-pr-scan.md is 45,927 B before this change — 153 B under its 46,080 B ceiling; Task 3 appends the `[human-approved]` exclusion there | fixed | Measured 46,015 B after Task 3 (composed pr-scan step 46,033/46,080; sweep-backstop ceiling test passes). Kept the one-line wording by SDD ruling; the next edit to this file must split it first (47 B composed headroom) |
| 3 | build | SDD Task 1 minor (deferred): no test pins scope-regex boundary cases (leading `/` or `.`, mixed case) | deferred | Whole-branch review triage: leave — those inputs are valid by the regex and harmless; the material edge (length) is now guarded and tested (c51d30ec0) |
| 4 | build | SDD Task 2 minor (deferred): the runner stdio test pins the source line rather than a runtime failing `execFileSync` | deferred | Whole-branch review triage: leave — the pin fails loudly on revert; the reviewer verified end-to-end with a fake `gh` that `err.message` still carries gh's error |
| 5 | build | SDD Task 3 minor (deferred): pr-first-merge.md Step 3 says the metric keys on "all three" tags just above the new excluded `human-approved` | deferred | Whole-branch review triage: leave — the following sentence states the exclusion explicitly |
| 6 | build | SDD Task 3 minor (deferred): the journey tag-list change has no test assertion | deferred | Whole-branch review triage: leave — descriptive doc; the brief asked for no test |
| 7 | build | Whole-branch review Minor 3: Step 3's "Append `--scope {scope}`" names no source for `{scope}` (no policy key, no record field), and the four local-merge fences carry no equivalent instruction | open | Outside this spec's AC (it names only pr-first-merge Step 3) — file a follow-up record at wrap-up |
