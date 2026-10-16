# Open Items — #3029 pr-state by-number argument guard

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Named-location drift: the record cites `archive-merged.js:1687` for the `resolvePrStateByNumber` call site; it is now at `:1818` (consumer still gates on `typeof === 'object'`, so no change needed) | observation | Verified at plan time; nothing outstanding |
| 2 | build/review | Whole-branch review (declined to judge): `resolvePrStateByNumber('/definitely/not/here', 42)` returns `'gh-absent'` — Node's ENOENT for a missing `cwd` is classified by `classifyGhApiError` as gh-absent, the same programming-error-reads-as-transport-failure family this record fixes, but for a non-existent repoRoot path | open | Pre-existing and outside this record's typeof-scoped spec — file a follow-up record at wrap-up |
| 3 | build | pr-state.test.js `installArgvSpy` duplicates most of `installGhWrapper` (mkdtemp/chmod/PATH swap) instead of an optional argv-log flag | deferred | Matches the file's existing two inline argv-spy copies; optional cleanup, below the materiality floor |
| 4 | build | close-out conformance test slices step 2 via first-occurrence `indexOf` of the step labels | deferred | Span ordering now asserted (9cfb79dd6); an earlier duplicate label would still shift it — latent only |
| 5 | build | close-out.md's string list is hand-duplicated with no prose-code twin test against pr-state.js | observation | Parked: three strings, one consumer doc; revisit if pr-state.js grows a fourth result string |
