# Open Items — 4596: Route the tidy and MCP stale-claim checks through one Node matcher over agent-fetched PR JSON

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — normalizePrListing rejects non-PR listing elements as failure: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — Resume-line dir and target classes are allowlists: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — parseResumeLine keeps a typeof runId string guard: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — resumeLineUnder reads the last Resume heading: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — Windows backslash run dirs read resolve, not resume: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | Follow-up idea (final review recommendation): route `flow/claim-targets.md`'s tombstone-PR `### Resume` parse (line ~270-286) through `pr-body.js`'s `resumeLineUnder`/`parseResumeLine` — the last prose copy of that grammar | open | Defer-reason: tangential — a capture candidate, not a fix to this record's two named prose files |
| 7 | build | `_shared/issue-claims.md` grew 46,992 → 47,311 B; `docs/journeys/compose-a-per-run-context-bundle-1988.md` Step 8 measured-bytes note for the `claims` bundle is now stale (wrap-up refresh convention) | open | — |
| 8 | build/skill | `mcp-agent-fetch-node-compute` gains an instance: `bin/stale-claim-pr.js --listing` (normalizer `bin/lib/issues/mcp-pr-shape.js`, run on both transports, rejecting any non-PR element as failure) — enrichment for its "Instances to copy from" table | open | — |
