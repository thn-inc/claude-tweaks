# Open Items — Console backfill records a truncated path for a finding at a path holding @ or [id]

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — a widened-only path (app/[id].tsx:3) now becomes a finding with a new id; intended, no-claim items never file: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | ratified at Review Console — intended: that no-claim item was this record defect; a no-claim item only digests, never files, so the no-second-record criterion holds |
| 2 | build | Minor 3: FINDING_PATH admits @ + ~ % $ so prose like finding@foo.ts:3 reports finding@foo.ts — Ruling: code stands; identical to resolve.js FINDING_LOC_RE's existing behavior, ids unaffected — cost if wrong: a rare prose-glued token reports a slightly wrong path, same as resolve.js already does | observation | Task review Minor 3, parked with ruling; consistent with the shared finding-path class (plugin/bin/lib/console/resolve.js FINDING_LOC_RE) |
| 3 | wrap-up | pr — PR #4691 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
| 4 | wrap-up | unknown — project test suite — the residue pack skipped its own suite re-run (--no-suite); suite state is taken from the verification pass stamp (verify.js at 573d8e65a: tests 8991 pass 0 fail, journeys 79 pass 0 fail) | observation | — |
