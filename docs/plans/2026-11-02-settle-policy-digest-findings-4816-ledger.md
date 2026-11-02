# Open Items — Settle 3 digest findings in policy

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 2 edits policy-schema.js by content, not by the plan's pre-Task-1 line numbers: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — NOT_YET_USED stays a hand-maintained list: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | review/convention | tests/resolve-policy-control-mode.test.js:240 — new test reused the AC1.1 label already on line 50 (low) | fixed | Label dropped, commit 9de2bf06c |
| 4 | review/convention | docs/journeys/review-project-policy.md:2 — files: frontmatter omitted plugin/bin/lib/model-profiles/policy-fragment.js (low) | fixed | Entry added, commit 9de2bf06c |
| 5 | review/test-quality | plugin/bin/lib/policy-schema.js:180 — NOT_YET_USED test only checked listed keys, so a wired key keeping the marker passed (low) | fixed | Added the reverse-direction test, commit 9de2bf06c |
| 6 | review/test-quality | plugin/bin/lib/model-profiles/policy-fragment.js:18 — CRLF \r drop by trimEnd never exercised (medium, tiebreak can't-tell) | fixed | Added a hash-free CRLF assertion; a trimEnd-less mutant went red, commit 9de2bf06c |
| 7 | review/convention | docs/journeys/review-project-policy.md:38 — "changes nothing" overstated for risk-categories/risk-path-globs validation coupling (info, tiebreak drop) | accepted | Sentence describes pipeline behavior, which holds; coupling is between two inert keys' audit output |
| 8 | review/convention | plugin/bin/lib/model-profiles/policy-fragment.js:16 — same-named stripComment in risk-path-globs.js (info, tiebreak drop) | accepted | risk-path-globs.js exports only parseRiskPathGlobs; both files document the deliberate split |
| 9 | review/test-quality | plugin/bin/lib/policy-schema.js:725 — no test runs both readers over one CRLF block (low, tiebreak drop) | accepted | Both readers call the same stripComment, which has its own CRLF unit test and an end-to-end audit test |
