# Open Items — compose-subject renders the record's "Filed by" footer as part of the release note (#4014)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | releaseNoteOf truncates a release note at any line starting `_Filed by` and ending `_` (pathological prose collision; regex is line-anchored) | deferred | Origin: SDD Task 1 review minor (deferred). Files: plugin/bin/lib/compose-subject.js (releaseNoteOf). Trigger: revisit if a record's release-note prose is ever observed to carry such a line. |
| 2 | build | No CRLF fixture pins compose-subject's footer regex (reviewer hand-traced it as working) | deferred | Origin: SDD Task 1 review minor (deferred). Files: tests/bin-lib/compose-subject.test.js. Trigger: revisit if a CRLF-bodied record is seen to leak its footer. |
| 3 | wrap-up | Supersedes row 1: the deferral carried no valid Defer-reason (minor severity is not one; fix-now eligible) — releaseNoteOf now requires the footer to be the section's last non-blank content | fixed | plugin/bin/lib/compose-subject.js (releaseNoteOf lookahead); go-red proven by dropping the lookahead against tests/bin-lib/compose-subject.test.js (mid-note case 2273). |
| 4 | wrap-up | Supersedes row 2: CRLF fixture added, same deferral-gate ruling | fixed | tests/bin-lib/compose-subject.test.js (record 2272 CRLF body; passes with and without the lookahead, so it pins existing behavior rather than a fix). |
