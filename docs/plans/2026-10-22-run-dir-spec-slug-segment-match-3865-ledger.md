# Open Items — #3865: resolve-run-dir --spec-slug matches by substring, so spec-378 adopts a spec-3784 run

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | No test covers the `-standalone` suffix shape or a regex-metacharacter slug (`tests/hooks-run-dir-resolve.test.js`) | deferred | — |
| 2 | build | `hasSegment` builds a RegExp per directory entry; could hoist out of the filter (`plugin/bin/lib/hooks/run-dir-resolve.js`) | deferred | — |
| 3 | build | `_shared/run-dir-resolution.md` bash snippet still globs `*${SPEC_SLUG}*` (substring) while `resolve-run-dir` now matches whole segments; the snippet is pinned verbatim by `tests/pipeline-run-dir-adoption-anchoring.test.js` | deferred | — |
