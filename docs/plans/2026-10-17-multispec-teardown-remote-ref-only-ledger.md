# Open Items — #3192 Multispec pr-first teardown archives the run directory too early (step 7)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Ruling: implementer ran focused tests only; Common Step 5 runs the full suite centrally and produces the verify stamp | observation | Common Step 5 full-suite run |
| 2 | build | docs/journeys/recover-a-teardown-with-no-recorded-worktree.md:33 quotes the old teardown-run --remote-ref-only skip line ("archival handled separately by Section B") — stale after a5924ff01 | resolved | Updated the quoted line (and an Updated-during-build note) in the journey during build |
| 3 | build | New #3192 test 1 also asserts `On approval" step 9` — weak secondary assertion; the --remote-ref-only command regex is the real discriminator | deferred | — |
