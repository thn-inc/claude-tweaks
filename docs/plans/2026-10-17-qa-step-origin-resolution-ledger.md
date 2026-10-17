# Open Items — #3005 QA dispatch rewrites step-level navigate origins

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Task 1 minor: go-red loop covers six literals only (plan-mandated); a table-driven loop over every assertion's key literal would pin AC3 "each assertion" fully | deferred | — (final review triaged "must fix, narrowly": the non-discriminating loopback assertion was fixed in `c5e13b23e`; full table-driven loop deferred) |
| 2 | build | SDD Task 1 minor: `/flag line\|flagged origins/i` is an either/or; anchor on the literal log-line text instead | fixed | Literal `QA: N navigate step origins rewritten to APP_URL` / `QA: flagged secondary origins` assertions with go-red controls — `c5e13b23e` |
| 3 | build | SDD Task 1 minor: classification silent on a root-relative navigate URL and on an absolute step URL already equal to APP_URL's origin while the story's own origin differs | fixed | Root-relative and APP_URL-equal cases added ahead of the classification, pinned — `c5e13b23e` |
| 4 | build | SDD Task 2 minor: `url-step` regex in `assertStoriesSchema` is greedy/unanchored — any later `navigate` step text in the schema section would satisfy it (not a problem at current head) | deferred | — |
| 5 | build | SDD Task 2 minor: `nav-target` mutation also removes the value-fallback sentence; stays discriminating only because `nav-target` is checked before `value-fallback` | deferred | — |
| 6 | build | SDD final re-review minor: story-origin rewrite log line (`QA: N stories had an embedded origin rewritten…`) is still unpinned by a literal assertion | deferred | — |
| 7 | build | SDD final re-review minor: protocol-relative navigate target (`//host/path`) is excluded by the root-relative case wording and falls through to the absolute-origin cases | deferred | — |
| 8 | build/skill | `skill-prose-conformance-tests` extension: `tests/qa-prompts-step-origin.test.js` proves go-red by mutating the live text in memory and matching each `assert.throws` on the targeted assertion's own message (with a `notEqual` no-op guard), instead of a frozen pre-change excerpt — this catches a mutation that fails a different assertion than the one it targets, which a bare `throws` misses | observation | — |
