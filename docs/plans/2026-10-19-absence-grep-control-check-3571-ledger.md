# Open Items — Add an absence-grep control check to plan authoring

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Ruling: the task review found two more specShapedBody AC-composition sites that list "a grep" as a criterion (wrap-up/leftover-routing.md:40, _shared/ledger-format.md:251), and ruled them in scope because the spec says "wherever that guidance tells an author to write a grep-shaped criterion" | observation | Fixed in fix round 1 (b0b2c1faf) with a literal pin each. Scoped re-review: ADDRESSED, no new breakage. Cost if wrong: two extra one-clause edits and two pins |
| 2 | build | SDD Task 1 minor: the prose test's exactly-once count for the bold lead is a case-sensitive substring count, so any prose mention of the phrase would also count | deferred | No stricter than the AC's own `grep -nF`; acceptable |
| 3 | build | SDD Task 1 minor: the reflect pin asserts the rule phrase but not the trailing `grep -F` remedy clause | deferred | A later edit could drop the remedy and keep the test green; low value to pin further |
