# Open Items — Windows regression: 2 test file(s) newly failing after f6e30ca84 (#3518)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow | Step 2.5 pre-flight branch-divergence-check: origin/main was 1 commit ahead of the worktree base 229108c65 | fixed | Post-creation catch-up fast-forwarded the branch to origin/main 52aabeb84 before any build commit |
| 2 | build | refusalFenceBody LF-normalization is redundant for the default arg (SHAPING_MODE already read via readText) — SDD task review minor | deferred | Origin: SDD Task 1 review (minor). Files: tests/specify-near-duplicate-prose.test.js. Trigger: none — spec Deliverable 2 mandates the normalization so the CRLF case (refusalFenceBody(text)) is meaningful; revisit only if refusalFenceBody's text parameter is removed |
