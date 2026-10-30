# Open Items — Review Console settles nothing for a finding whose path holds characters outside [A-Za-z0-9_./-] (#4582)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `plugin/bin/lib/console/backfill.js` `LOCATION_RE` and its line 337 `loc` regex hold the same class, so a backfilled finding at such a path records a truncated path; widening them re-ids stored backfill items, because `backfillItemId` hashes the path | open | — |
| 2 | build | A path holding a space still truncates (`my dir/x.ts:3` keys `dir/x.ts:3`), so two such paths can collide; a space cannot join the class without capturing prose, and parsed verdicts already hold the whole path | open | — |
