# Open Items — /review Step 6.7's QA re-run omits --source review (#3771)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | AC 2 is enforced by two point pins, not a file-wide sweep; a future third mid-review /test call would not be caught | deferred | → backlog; origin #3771 review sweep gap, files plugin/skills/review/*.md and tests/review-qa-rerun-after-fix-wave-conformance.test.js, trigger: any new mid-review /test call; staged/ledger-record-sweep-pin.md (defer-reason: tangential) |
| 2 | build | test/SKILL.md:227 still names only Step 1.5 as passing --source review; Step 4 and Step 6.7 now pass it too (contract wording understates, behavior unaffected) | fixed | wrap-up Phase 1 fix-now: plugin/skills/test/SKILL.md Component-Skill Contract now names all four standalone calls; commit e8c2275bd |
| 3 | review/observation | review/step3-routing.md:117,121,131,151 name mid-review /claude-tweaks:test re-verify calls (Step 3 Routing fix wave, parallel-fix dispatch) without --source review; a standalone review gets the same nested Next Actions block there. Outside this record Key Files (pre-existing-outside-diff) | fixed | wrap-up Phase 1 fix-now (localized, same defect class as #3771): plugin/skills/review/step3-routing.md re-verify sites now pass --source review; commit e8c2275bd |
| 4 | wrap-up | pr — PR #3821 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | |
| 5 | wrap-up | suite probe — skipped via --no-suite (fact pack never re-runs the suite); suite state taken from verify.js full pass stamp at 3a0954637 (tests 14386, fail 0) | observation | |
