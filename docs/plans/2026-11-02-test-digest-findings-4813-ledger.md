# Open Items — Settle 15 digest findings in tests (#4813)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — go-red checks run in a scratch checkout, not in-place: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — established-maturity characterization rule does not apply to a test-only build: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — whole-file tmp leaks in engine-verify and hooks-policy-exemption fixed in this build: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — T5 derived-key guard and T6 title minor fixed in the fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — AC1.1 disposition comment on #4813 is a controller action after verification: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | engine-verify.test.js keeps its older mirrorRoots test.after hook, now redundant because every mirrorFixture root also registers through makeTmpDir (harmless double cleanup with force:true) | observation | Fix-wave re-review out-of-scope note; not a defect — no change owed |
| 7 | build | tests/helpers/git-fixtures.js gitRepo()/linkedWorktreeOf() leak their mkdtemp dir if they throw before returning | observation | Fix-wave re-review out-of-scope note; closing it needs a shared-helper edit outside this diff — Defer-reason: pre-existing-outside-diff |
| 8 | build | Post the AC1.1 disposition comment on #4813 (all 15 Deliverables with fix commits; D9/D10/D13 settled by scope documentation) | open | — |
| 9 | build/skill | bin-source-scan-conformance does not cover accept-label-reader-conformance's DEMO_ matcher, whose exact-name negative-lookahead exclusion with one go-red row per `\b` (DEMO_ACCOUNT_PENDING, DEMO_CREDENTIAL_RE_BATCH) is a reusable rule for any scan with a named-exclusion list (enrichment) | observation | Skill observation for /wrap-up's Skills curation row |
