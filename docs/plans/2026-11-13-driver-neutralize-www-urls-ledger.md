# Open Items — Remove www. and bare github.com issue URLs from driver worker text in linear time

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/skill | regex-scan-linearity gains four #5352 wrinkles: a www. domain guard that stops before a later valid start ([\d_](?!www\.)), digit-admitting boundaries so back-to-back references go in one pass, length-bounded owner/repo (39/100) so a long a-a- or digit run scans a bounded span per start, and a post-loop removal pass that can open a word boundary (\b) for an earlier pattern (GH_REF) so that pattern runs once more | observation | — |
