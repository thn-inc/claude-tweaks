# Open Items — Release workflow branch quoting (#4714)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — filter-line ACs pin rendered file text (two backslashes), not the decoded value: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | ratified at Review Console — the spec's own Technical Approach step 3 (escape, then JSON.stringify) produces exactly this file text |
| 2 | build | SDD ruling — the ${{ refusal keeps the existing "invalid branch name" error wording: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | accepted | ratified at Review Console — so the existing test regex and the CLI's stderr path keep working (the CLI now pre-checks with its own 'invalid --branch' usage wording, c91c881b1) |
| 3 | wrap-up | Reflect (Friction): near-duplicate screen at /specify returned 40 score-1 hits anchored only on punctuation/literal spans (`/`, `null`, `origin/main`), forcing a deviation from "append every candidate to **Related:**" (staged/reflect-1.md) | deferred | Defer-reason: tangential — backlog proposal staged/reflect-1.md, resolves at the Review Console's Queue writes |
| 4 | wrap-up | Reflect (Near-misses): the shaped spec asserted isValidBranchName excludes all control characters; it admits C1 (\x80-\x9f) — caught by the task review, fixed in round 1 | accepted | Don't capture: already covered by the existing "fact-check claims vs files" plan-authoring memory; the defect was caught and fixed in-build, no new learning |
