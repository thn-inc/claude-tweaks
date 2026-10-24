# Open Items — dispatch/task-prompt.md: the worktree shell constraint list omits the backslash-escaped-space path shape

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task review minor: the item 6 agreement test asserts the bare substring `double-quote`, so an edit could drop the fix and keep the word elsewhere in item 6 (tests/scratch-worktree-shell-constraint-table.test.js) | fixed | Fixed in review: the assertion now anchors on `double-quote the whole path instead`, the fix clause itself, so dropping the fix fails the test |
| 2 | wrap-up | pr — PR #4194 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | Disposition is the Review Console's merge decision |
| 3 | wrap-up | suite — residue probe skipped via --no-suite (a fact pack never re-runs the suite) | observation | Suite state taken from the runner stamp instead: scoped pass at HEAD b8b2d01b7 anchored on the full pass (16561 tests, 0 failed) at 3fe243930 |
