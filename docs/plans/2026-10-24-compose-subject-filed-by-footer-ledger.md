# Open Items — compose-subject renders the record's "Filed by" footer as part of the release note (#4014)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | releaseNoteOf truncates a release note at any line starting `_Filed by` and ending `_` (pathological prose collision; regex is line-anchored) | deferred | Origin: SDD Task 1 review minor (deferred). Files: plugin/bin/lib/compose-subject.js (releaseNoteOf). Trigger: revisit if a record's release-note prose is ever observed to carry such a line. |
| 2 | build | No CRLF fixture pins compose-subject's footer regex (reviewer hand-traced it as working) | deferred | Origin: SDD Task 1 review minor (deferred). Files: tests/bin-lib/compose-subject.test.js. Trigger: revisit if a CRLF-bodied record is seen to leak its footer. |
