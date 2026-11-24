# Open Items — Rebuild a conflicting learned-skills PR on the integration tip during the drain (#6113)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Fixture helper shared between Task 2 and Task 3 tests: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — Task 2 recovered from a dead implementer and committed by the controller: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — Dedupe whole lessons, not verbatim lines (spec intent over spec literal): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — One targeted fix for the post-range mid-list check residuals: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — Controller fix: a list run closes only after a blank line or a heading: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | Deliverable 6 / AC7: post-ship migration — after release and claude plugin update, run learned-skills-pr.js drain on this repo (max 3 passes, each waiting out CI) until no learned-skills PR is open except ones reported conflict needs a human (each gets a PR comment naming the file); quote gh pr list --state open --search 'wrap-up-skills-pr in:body' in a comment on #6113 | open | Defer-reason: blocked-external — needs this change released and the installed plugin updated; unblocked by the release that ships #6113 |
| 7 | build/skill | gh-api-module-pattern git-seam.md: plugin/bin/lib/learned-skills/rebuild.js extends the scratch-index rule with a worktree-free 3-way merge recipe (merge-tree --write-tree -z exit 1 read from err.stdout, merge-file over cat-file blob temp files since --object-id needs 2.43, merge-file stdout as a Buffer with a fatal UTF-8 decode so a non-UTF-8 file refuses instead of being corrupted) worth documenting | open | — |
