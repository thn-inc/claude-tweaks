# Open Items — skill-prose-conformance-tests skill: add the roster-coverage pin pattern (#4185)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `tests/ceremony-profile-roster.test.js` has the forward sweep but no reverse staleness check: a `## Mentions that are not skips` row in `plugin/skills/_shared/ceremony-profile.md` whose file/line no longer carries a fast-lane+skip line, or a skip tag no live `roster tag` cites, stays green (found while verifying #4185's premise). Fix: add a reverse test asserting every Mentions row still matches a live fast-lane+skip line and every skip tag is still cited, plus a go-red control; prune any stale rows it finds. Defer-reason: pre-existing-outside-diff — the test file is not in this build's diff, and pruning stale rows may touch the shipped roster `_shared/ceremony-profile.md`. Once fixed, #4185's Decision Framework row sentence "has no reverse check" needs updating | open | — |
