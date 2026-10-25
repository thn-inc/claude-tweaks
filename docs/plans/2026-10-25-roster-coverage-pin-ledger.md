# Open Items — skill-prose-conformance-tests skill: add the roster-coverage pin pattern (#4185)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `tests/ceremony-profile-roster.test.js` has the forward sweep but no reverse staleness check: a `## Mentions that are not skips` row in `plugin/skills/_shared/ceremony-profile.md` whose file/line no longer carries a fast-lane+skip line, or a skip tag no live `roster tag` cites, stays green (found while verifying #4185's premise). Fix: add a reverse test asserting every Mentions row still matches a live fast-lane+skip line and every skip tag is still cited, plus a go-red control; prune any stale rows it finds. Defer-reason: pre-existing-outside-diff — the test file is not in this build's diff, and pruning stale rows may touch the shipped roster `_shared/ceremony-profile.md`. Once fixed, #4185's Decision Framework row sentence "has no reverse check" needs updating | open | — |
| 2 | build | Reference-section citation assertion has no doctored-text go-red control (tests/skill-prose-roster-coverage-pin.test.js:116-119) | deferred | SDD task-review minor |
| 3 | build | The row's "forward sweep only / no reverse check" qualifier for ceremony-profile-roster is not pinned, so the row could drift to overclaim | deferred | SDD task-review minor |
| 4 | build | SDD ruling — followed the plan's premise correction (only timing-nested-parent-roster carries both halves) over the spec's Current State: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
