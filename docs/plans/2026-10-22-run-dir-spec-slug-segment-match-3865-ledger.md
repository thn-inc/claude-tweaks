# Open Items — #3865: resolve-run-dir --spec-slug matches by substring, so spec-378 adopts a spec-3784 run

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | No test covers the `-standalone` suffix shape or a regex-metacharacter slug (`tests/hooks-run-dir-resolve.test.js`) | fixed | Added left-boundary, lone-spec-3784, `-standalone` and `release.1` metacharacter tests — `182b26208` |
| 2 | build | `hasSegment` builds a RegExp per directory entry; could hoist out of the filter (`plugin/bin/lib/hooks/run-dir-resolve.js`) | accepted | Not worth a closure: the filter runs over the handful of canonical run dirs under `.claude-tweaks/pipelines/`, once per resolve call |
| 3 | build | `_shared/run-dir-resolution.md` bash snippet still globs `*${SPEC_SLUG}*` (substring) while `resolve-run-dir` now matches whole segments | fixed | Snippet now globs `*-${SPEC_SLUG}` / `*-${SPEC_SLUG}-*`; two executed-snippet tests added to `tests/pipeline-run-dir-adoption-anchoring.test.js` — `182b26208` |
| 4 | review/convention | `plugin/skills/wrap-up/merge-mode.md:13` still described `--spec-slug` as a substring match | fixed | Reworded to the whole-segment behavior, guard rationale kept — `182b26208` |
