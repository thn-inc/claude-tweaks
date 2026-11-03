# Open Items — dispatch: shipped-candidate exclusion treats an API-first half PR's non-closing "Refs #N" as shipping the whole record

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Task 1 minors left by the final review as cosmetic: the `PREDATES_CLAIM_RELEASE` export in `shipped-candidate.js` has no consumer; no test for an unparseable `mergedAt` on a record with no `createdAt`, or for two predating mentions (the doc-comment placement and double `mergedAtMs` parse were fixed by Common Step 3's simplify) | open | — |
| 2 | build | `queue-pull-script.md:11`'s `reason: 'shipped'` summary bullet names #4314 but not #4432 (final review: optional; the file has 95 B of rail headroom) | open | — |
| 3 | build | A later claim overwrites the release tombstone, so a re-claimed record loses its release time; the final review found it exposed only by label drift on a live claim (a live claim carries `bot:in-progress` and leaves the queue) | observation | Plan review and final review triage; the prior behavior holds when no release time is readable (AC4) |
