# Open Items — Rank near-duplicate hits by shared-anchor depth (#4701)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | review | Low test-quality: `tests/bin-lib/issues/near-duplicate.test.js:189` — the renamed sorting test claimed the depth fold, but its fixture passes under the old sort too | fixed | Test renamed to what its fixture pins; the depth fold stays pinned by the AC1.1 and equal-key tests |
| 2 | review | Low convention: `plugin/skills/specify/shaping-mode.md:102` — no fence ever called `deepOverlapHits`, so the model applied the 3-anchor threshold by hand | fixed | The refusal fence now prints `deep` from `deepOverlapHits(hits)`; the prose names `deep`, and a prose-test pin covers the fence |
| 3 | review | Low test-quality: `tests/specify-near-duplicate-prose.test.js:194` — the section slice did not assert that its anchors exist | fixed | Added an `assert.ok` on both anchors |
| 4 | review | Low coverage: `plugin/bin/lib/issues/near-duplicate.js:252` — no test covered which candidate the refusal names after the depth sort | fixed | Added a finder-to-`shapingRefusal` composition test; reverting the sort turns it red |
| 5 | review | Low test-quality: `tests/specify-near-duplicate-prose.test.js:203` — the negative pin on `ranks such a hit first` guards wording that no shipped file contains | open | Staged as staged/review-1.patch (the test-removal override forbids auto-apply) |
