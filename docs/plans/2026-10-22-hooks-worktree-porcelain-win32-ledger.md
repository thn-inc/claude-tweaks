# Open Items — Hooks: match git worktree porcelain paths against native cwd on Windows (#3811)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD minor: `teardown-run.js` `const path = require('path')` left dead after `findWorktreeEntry` moved to `worktree-reap.js` | fixed | Removed in e6ad03cf9 |
| 2 | build | SDD minor: AC3 pin regex `/\.path\s*===\s*cwd\b/` matches only that literal spelling (misses `==`/`!==`/swapped operands) | accepted | Mirrors the spec's own AC3 idiom; both real sites are gone and the test name was narrowed to the literal idiom in 69f8415df, so it no longer overclaims |
| 3 | build | SDD minor: `post-tool-use.js` comment above `resolveWorktreePathViaPorcelain` lacked the win32 slash/case-tolerance note | fixed | Clause added in 69f8415df |
| 4 | build | SDD ruling — #3695 AC3 `findWorktreeEntry(` count lowered from `>= 3` to `>= 2` after the helper moved out of teardown-run.js: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
| 5 | build | SDD ruling — dead `path` import removal folded into the Task 2-4 batch instead of a Task 1 fix round: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | |
| 6 | build | SDD ruling — plan Tasks 2-4 dispatched and reviewed as one batch (haiku implementer per size:low): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | |
| 7 | build | SDD ruling — all three final-review Minors applied in the one fix wave instead of deferred: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | |
