# Open Items — gh-api-module-pattern skill: real-subprocess test runners must forward the caller's options (#2852 encoding drop)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Task review minor: lead clause "that a test wraps around `execFileSync`" in the new SKILL.md bullet reads slightly awkwardly — "a test fixture's real-subprocess runner" would be more direct (polish only) | deferred | |
| 2 | build | Observation: `tests/bin-lib/issues/claims-git-cas.test.js`'s `realRunner` (lines 78-82) still rebuilds a narrowed options object (`encoding: 'utf8'` hardcoded) — the shape the new bullet warns against; PR #2885's `defaultRunner` test covers the #2852 path, out of scope for #4189 | observation | |
