# Open Items — Hooks: match git worktree porcelain paths against native cwd on Windows (#3811)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD minor: `teardown-run.js` `const path = require('path')` left dead after `findWorktreeEntry` moved to `worktree-reap.js` | fixed | Removed in e6ad03cf9 |
| 2 | build | SDD minor: AC3 pin regex `/\.path\s*===\s*cwd\b/` matches only that literal spelling (misses `==`/`!==`/swapped operands) | fixed | Superseded in review (row 8): the scan moved to `tests/porcelain-cwd-compare-conformance.test.js` and matches `===`/`!==`/`==`/`!=` in both operand orders |
| 3 | build | SDD minor: `post-tool-use.js` comment above `resolveWorktreePathViaPorcelain` lacked the win32 slash/case-tolerance note | fixed | Clause added in 69f8415df |
| 4 | build | SDD ruling — #3695 AC3 `findWorktreeEntry(` count lowered from `>= 3` to `>= 2` after the helper moved out of teardown-run.js: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
| 5 | build | SDD ruling — dead `path` import removal folded into the Task 2-4 batch instead of a Task 1 fix round: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | |
| 6 | build | SDD ruling — plan Tasks 2-4 dispatched and reviewed as one batch (haiku implementer per size:low): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | |
| 7 | build | SDD ruling — all three final-review Minors applied in the one fix wave instead of deferred: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | |
| 8 | review/3a,3f | Medium (reproduced by both lenses): the AC3 scan in `tests/hooks-worktree-reap.test.js` read raw text with a version-dependent recursive `readdirSync`, no `stripComments`/`stripperVerdict`, no walk floor, no planted self-test, and a literal-only matcher (`bin-source-scan-conformance`) | fixed | Moved to `tests/porcelain-cwd-compare-conformance.test.js` (shared stripper + verdict offender, non-recursive walk, `>= 400` file floor, planted go-red and negative cases, `===`/`!==`/`==`/`!=` in both operand orders); old test removed; goes red under a restored strict compare |
| 9 | review/3f | Medium (reproduced): `stampAdHocRunDirForDenial` had no pin of its own — restoring an inline strict compare there left every new pin green | fixed | Pin added in `tests/hooks-denial-run-dir.test.js` (a cwd with a trailing separator still stamps; red under a strict compare, verified by mutation) |
| 10 | review/3f | Low (single-source): `listedWorktreeForCwd`'s failed-listing branch had no pin | fixed | Failing-`runGit` case added to the existing win32 pin |
| 11 | review/3a | Low (single-source): `teardown-run.js` still re-exports `findWorktreeEntry` with no recorded removal condition | open | Staged low-confidence; deliverable 1 of the record names the re-export as acceptable and `tests/hooks-worktree-reap.test.js` pins it |
| 12 | review/3a | Low (single-source): `findWorktreeEntry`'s unit tests (`tests/hooks-teardown-run.test.js`) stay beside teardown-run, not the module it now lives in | open | Staged low-confidence |
| 13 | review/3f | Low (single-source): the empty-cwd assertion passes without the guard, and case folding is pinned only on the drive letter | open | Staged low-confidence |
