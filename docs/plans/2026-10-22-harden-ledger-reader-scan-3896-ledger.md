# Open Items — Harden the ledger-reader conformance scan against sentence-level and glob-spelling escapes

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Lookup spellings beyond the spec list still escape the matcher (`rg --files docs/plans \| rg ledger`; `ls -t docs/plans \| head \| grep ledger`; a path split across two backtick spans) — SDD task review minor, tests/ledger-reader-ownership-conformance.test.js | fixed | The two listing spellings are matched now (third pattern takes `ls`/`rg` and any number of pipe stages), each with a go-red fixture, `659a37418`; the split-span remainder is item 3 |
| 2 | build | Matcher patterns 1 and 2 can both match one occurrence, duplicating it in the failure message (cosmetic) — tests/ledger-reader-ownership-conformance.test.js | fixed | The failure message lists each distinct matched text once, `659a37418` |
| 3 | wrap-up | A lookup path split across two backtick spans (`` `docs/plans/` ... `*-ledger.md` ``) still escapes the matcher — tests/ledger-reader-ownership-conformance.test.js | accepted | Intentional: no regex can pair the two spans without also matching the legitimate Create-location prose (`docs/plans/YYYY-MM-DD-{feature}-ledger.md`); the journey names it as a red flag for reviewers instead |
| 4 | wrap-up | Four pre-existing go-red `assert.throws` calls carried no message matcher, so any thrown error (a TypeError included) satisfied them — tests/ledger-reader-ownership-conformance.test.js | fixed | Each now matches the scan's own failure message, `e22dfb00a` |
