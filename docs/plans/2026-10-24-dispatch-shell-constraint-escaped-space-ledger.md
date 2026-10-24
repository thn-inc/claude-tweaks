# Open Items — dispatch/task-prompt.md: the worktree shell constraint list omits the backslash-escaped-space path shape

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task review minor: the item 6 agreement test asserts the bare substring `double-quote`, so an edit could drop the fix and keep the word elsewhere in item 6 (tests/scratch-worktree-shell-constraint-table.test.js) | fixed | Fixed in review: the assertion now anchors on `double-quote the whole path instead`, the fix clause itself, so dropping the fix fails the test |
