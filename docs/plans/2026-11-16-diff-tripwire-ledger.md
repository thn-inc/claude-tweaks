# Open Items — Diff tripwire

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 4 commits ahead of the branch at resume | fixed | Common Step 1 catch-up merged origin/main (b34ec5264b) into the worktree branch |
| 2 | build | SDD ruling — POINTER_BYTES 560 headroom on Step 2.9 needs no change: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — glob-syntax parser/matcher alignment goes to follow-up #5806 (Defer-reason: pre-existing-outside-diff): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — final reviewer declined-to-judge items accepted as designed: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build/skill | gh-api-module-pattern git-seam.md extends: a git fetch run in the shared main checkout should retry once on a sibling session's ref lock (cannot lock ref / Unable to create .lock) through an injectable sleep before reporting failure, as accept-park.js fetchRef now does (#4619) | observation | — |
