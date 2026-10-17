# Open Items — #3394 Review Console Approve-all drops verify-expectations issues

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | finish-console decision-log header counts memory/upstream/ledger but not issues (SDD Task 1 minor) | fixed | Fixed in final-review fix wave 0b5e81d38 — header and stdout summary now append `, issues: [...]` when the payload carries it |
| 2 | build | explicit `issues: []` clears a stored issues array (mergeExpectations truthy check), unpinned by a test (SDD Task 1 minor) | accepted | Final whole-branch reviewer triage: intended semantics; step 11 prose says omit the key when no record resolves, so `[]` is never sent by the documented caller |
| 3 | build | finish-console payload-shape comment terse about differing memory/upstream vs ledger defaults (SDD Task 1 minor) | accepted | Final whole-branch reviewer triage: cosmetic, accurate as written |
| 4 | build | review-console.md:120 "--issues ... after the write above" could read as also applying under Approve all (SDD Task 2 minor) | accepted | Final whole-branch reviewer triage: worst case one redundant idempotent call setting the same value; harmless |
| 5 | build | review-console-appendix.md:98 rewritten line ~190 chars vs surrounding ~100-char wrap (SDD Task 2 minor) | accepted | Final whole-branch reviewer triage: cosmetic only, no test or meaning affected |
