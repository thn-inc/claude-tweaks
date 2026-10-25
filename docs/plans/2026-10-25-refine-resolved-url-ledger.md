# Open Items — stories/refine.md 5a: resolve story URL against the run APP_URL like qa-prompts.md resolved_url

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow/ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of the adopted worktree branch | fixed | Post-creation catch-up fast-forwarded the branch to `853e54f95` |
| 2 | build | SDD task review minor: 5b negative assertion pins only the exact phrase "Re-open the story's URL" (positive assertion covers the real prose) | deferred | Origin: SDD Task 1 review of `09c4fd186`; files: `tests/stories-refine-resolved-url.test.js`; trigger: revisit if refine 5b's re-open prose is reworded |
| 3 | build | SDD task review minor: `declaredMessages()` regex skips apostrophe-bearing assertion messages; the coverage check still fails loudly, but the constraint is undocumented in the test | deferred | Origin: SDD Task 1 review of `09c4fd186`; files: `tests/stories-refine-resolved-url.test.js`; trigger: revisit when an assertion message with an apostrophe is added |
| 4 | build | SDD task review minor: refine 5a step 2 lead-in is one dense sentence | deferred | Origin: SDD Task 1 review of `09c4fd186`; files: `plugin/skills/stories/refine.md`; trigger: revisit at /review's prose pass |
| 5 | build | SDD task review minor: refine 5a has no `navigate`-step origin rewrite, while `qa-prompts.md` also rewrites `navigate` step URLs; #4184 scopes the fix to `story.url` | deferred | Origin: SDD Task 1 review of `09c4fd186` (⚠️ item, ruled out of scope by the spec's Deliverable 1); files: `plugin/skills/stories/refine.md`; trigger: revisit if refine starts executing `navigate` steps or a stale step origin is observed in refine |
