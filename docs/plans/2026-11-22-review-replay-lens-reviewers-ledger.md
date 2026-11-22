# Open Items — Replay archived lens reviewers on any model and effort, and score each arm against the review's confirmed findings (#5991)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — fixture variant l3c-a is described `Review lens 3c tests A` and l3d-a `Review lens 3d docs: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — zero selected slots exits 3 with the shortfall JSON even without --min-reviews: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — bare main-checkout path: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — outDir skip applies only when outDir lies strictly under mainRoot: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — Task 4 repo directory is `repos/{run}--r{k}/repo` (k = 1-based index of the distinct (run,: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — fix crosses into Task 2's module: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build | SDD ruling — final-review Important 1: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 8 | build | SDD ruling — final-review Important 2: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 9 | build | SDD ruling — queued minor "validate --reference before reading files" → no action: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
| 10 | build | SDD ruling — revise R1 (residual after the final fix wave → one targeted fix + one scoped re-review, di: ratify or reverse at the Review Console (staged/sdd-ruling-10.md) | open | — |
| 11 | build | SDD ruling — concern (b) fixed in the same targeted dispatch: ratify or reverse at the Review Console (staged/sdd-ruling-11.md) | open | — |
| 12 | build | perf/review-replay-rewrite-linearity.test.js times the foreign-root scan with a cheap Map predicate at N=8000, so it cannot catch removal of the 4096-char prefix cap (uncapped with a statSync predicate: 16000 markers 1878 ms, 32000 out of heap); the unit test pins the cap's behaviour — make the perf case statSync-shaped or larger. | observation | — |
| 13 | review | Lens 3f (reproduced): tests/review-replay/reviews-rewrite.test.js:303 pins the exact exists() probe order; staged as an order-independent set comparison (test-assertion change, never auto-applied) | open | Ledger: staged/review-1.patch — resolves at the Review Console's apply step |
| 14 | review | Lenses 3a+3c (tiebreak-confirmed, medium): reviews-extract.js dispatchesOf dropped dispatches with no excluded row on an unreadable timing.json, a non-array items, a non-object item, an unreadable run dir, or a missing root timing.json | fixed | 14b307fa7: excluded as timing-unreadable / no-timing; tests added. |
| 15 | review | Lens 3a (tiebreak-confirmed, low): REVIEW_EXCLUSION_REASONS was never checked against the reasons reviews-extract.js emits | fixed | 14b307fa7: every exclusion goes through one helper that throws on an unlisted reason. |
| 16 | review | Lens 3c (tiebreak-confirmed, low): existsOnDisk treated any statSync error as absent, so an EACCES/EIO prefix passed the leak barrier | fixed | 14b307fa7: only ENOENT/ENOTDIR count as absent; unit test added. |
| 17 | review | Lenses 3a+3f (tiebreak-confirmed, low/info): duplicated cleanEnv and git/writeRepo deps overrides in the review-replay tests; bare effort-mismatch test name | fixed | 14b307fa7: cleanEnv exported from reviews-fixture.js, makeDeps takes a main root, test renamed to its capability. |
| 18 | review | Lens 3f (tiebreak cant-tell/evidence-unverified, info/low): reviews-rewrite.test.js:309 threshold-only fixture length; perf linearity case's single total budget; makeWriteRepo GIT_* filter unpinned by a test | accepted | Below the materiality floor, digested: https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-7084225103 |
| 19 | review | Lens 3f + tiebreak probe (row 12's observation): no test caught removal of the 4096-char prefix cap before exists() in reviews-rewrite.js:199 | fixed | 14b307fa7: reviews-rewrite.test.js pins the cap with an exists spy; red with the cap removed (2 fail, 38 pass), green restored (40 pass). |
