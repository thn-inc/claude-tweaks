# Open Items — _shared/pr-run-comments.md Find step writes the comments payload to a fixed shared /tmp path

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/scope | `plugin/skills/_shared/pr-first-merge.md:253-254` writes and reads the park comment body at the fixed shared `/tmp/park-comment-{n}.md`. It is the same session-tmp-root hazard as #4065, in a file this diff does not touch. Defer-reason: pre-existing-outside-diff | open | — |
