# Open Items — Harden the ledger-reader conformance scan against sentence-level and glob-spelling escapes

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Lookup spellings beyond the spec list still escape the matcher (`rg --files docs/plans \| rg ledger`; `ls -t docs/plans \| head \| grep ledger`; a path split across two backtick spans) — SDD task review minor, tests/ledger-reader-ownership-conformance.test.js | deferred | SDD task-review minor (deferred); origin: Task 1 review of 3bdac8a; affected: tests/ledger-reader-ownership-conformance.test.js; revisit if a skill adopts one of these spellings |
| 2 | build | Matcher patterns 1 and 2 can both match one occurrence, duplicating it in the failure message (cosmetic) — tests/ledger-reader-ownership-conformance.test.js | deferred | SDD task-review minor (deferred); origin: Task 1 review of 3bdac8a; affected: tests/ledger-reader-ownership-conformance.test.js; revisit only if the duplicate message confuses a reader |
