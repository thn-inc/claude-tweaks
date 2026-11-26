# Open Items — specify: one session-wide shaped-body temp file lets a sweep write a body onto the wrong record

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence: origin/main was 1 commit ahead at run start | fixed | Merged origin/main into the branch at Common Step 1 catch-up, merge commit 1fa25109a1 |
| 2 | build | Creation-flow specify temp files (specify-sub-issue-body.md, specify-parent-body.md and their payload files in record-creation.md / record-creation-subissues.md) still use one fixed path per session; sibling dispatches sharing a session id could cross-wire a created record's body | open | Defer-reason: genuinely-larger — no record id exists at resolve time, so keying needs a new scheme (unit index plus parent or design-doc slug) the spec does not define; settled out of #4746's scope at plan review (Reading A); route to /claude-tweaks:capture with a spec-shaped body at wrap-up |
