# Open Items — #3438 claims: reuse claim-store resolveRepoSlug in claim-targets.js repoSlugOf

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | resolveRepoSlug returns null (was literal 'undefined') on an undefined gh stdout — bug fix, pinned transitively via resolveRepoSlugOrThrow test | deferred | SDD task review minor; no caller depends on the old value (sole caller createClaimReader handles null) |
| 2 | build | resolveRepoSlugOrThrow(deps.gh) falls back to the real gh runner if deps.gh is undefined (was TypeError) — theoretical, CLI always injects gh | deferred | SDD task review minor; plugin/bin/claim-targets.js always supplies gh: defaultGh |
| 3 | build | identity-rethrow assertion's discrimination against a wrapping impl not demonstrated in the implementer report | deferred | SDD task review minor; review may run a revert-to-red check |
| 4 | build | Ruling: implementer ran focused suites only, not full npm test before commit — /build Common Step 5 runs the full suite centrally and produces the pass stamp — cost if wrong: a cross-suite regression surfaces at Step 5 instead of in the task report | observation | Controller re-ran focused suites centrally: 130/130 pass |
