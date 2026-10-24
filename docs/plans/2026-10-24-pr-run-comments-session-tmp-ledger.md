# Open Items — _shared/pr-run-comments.md Find step writes the comments payload to a fixed shared /tmp path

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/scope | `plugin/skills/_shared/pr-first-merge.md:253-254` writes and reads the park comment body at the fixed shared `/tmp/park-comment-{n}.md`. It is the same session-tmp-root hazard as #4065, in a file this diff does not touch. Defer-reason: pre-existing-outside-diff | open | — |
| 2 | build | SDD ruling — fold both Minor review findings (no positive body-path pins; PRE_CHANGE_TOMBSTONE_ROW whitespace churn) into fix round 1 rather than deferring them: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
