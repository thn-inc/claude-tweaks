# Open Items — flow: a freshly claimed run dir absorbs other sessions' fallback-attributed events and preflight adopts it as case 3

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD minor (Task 1): no test pins the unreadable-decisions.md (non-ENOENT) stays-adopted branch of isUnadoptedMint (plugin/bin/lib/hooks/context.js) | fixed | Final-review fix wave commit ea825610c added the EISDIR test in tests/hooks-run-attribution.test.js (red under mutation, green restored) |
| 2 | build | SDD minor (Task 1): post-tool-use.js rollbackMint comment says isUnadoptedMint treats any touched decisions.md as adopted | accepted | Final whole-branch review: still accurate — that mint writes an empty decisions.md, which classifies 'empty' and stays adopted; no change needed |
| 3 | build | SDD minor (Task 2): AC3.1 has no literal "attribution":"env" fixture | accepted | Final whole-branch review: appendEvent only writes attribution for 'fallback', so the untagged fixture is the real env/session shape |
| 4 | build | SDD ruling — route the Step 2.8 SKIP-bookkeeping / paraphrased-claim mint shapes (claim-targets.md:117/:219, #3012; classifyDecisions returns 'content' so isUnadoptedMint and preflight decisionsHasContent treat the mint as adopted) to a follow-up record instead of widening #3363: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
