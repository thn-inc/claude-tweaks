# Open Items — Console backfill records a truncated path for a finding at a path holding @ or [id]

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — a widened-only path (app/[id].tsx:3) now becomes a finding with a new id; intended, no-claim items never file: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | Minor 3: FINDING_PATH admits @ + ~ % $ so prose like finding@foo.ts:3 reports finding@foo.ts — Ruling: code stands; identical to resolve.js FINDING_LOC_RE's existing behavior, ids unaffected — cost if wrong: a rare prose-glued token reports a slightly wrong path, same as resolve.js already does | observation | Task review Minor 3, parked with ruling; consistent with the shared finding-path class (plugin/bin/lib/console/resolve.js FINDING_LOC_RE) |
