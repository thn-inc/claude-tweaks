# Open Items — pr-early-open logs "reopened PR" after a gh exit 0 without confirming the PR is OPEN

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — could-not-confirm line writes "failed" in {error} as "errored": ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | ratified at Review Console — the module header's rule that a line on a path that can leave the run PR-less must not contain the word failed; a verbatim error would falsely release the bookkeeping gate |
| 2 | build | SDD ruling — fix also updates the lifecycle spec and the CLI comment, beyond Key Files: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | accepted | ratified at Review Console — the module declares the lifecycle file its spec, and leaving Reopen succeeds as exit-0 semantics would make the spec lie; the runner stays untouched |
