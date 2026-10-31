# Open Items — Revisit the 24-hour floor before reconcile asks run-liveness about an interrupted run

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — fix-brief check 3 narrowed to "a later session's activity" (line 487 unrelated): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | review | Lens 3a (low): `plugin/bin/lib/reconcile/archive-merged.js:325` comment said "a handful" of resumes came past 24h; the cited ruling records one (an undercount) | fixed | f39ada85e — "one resume past 24h, an undercount" |
| 3 | review | Lens 3a (low, tiebreak-confirmed): plan's Measured data and Step 1 text (`:23`, `:27`, `:61`) carry the pre-dedupe episode counts that contradict the shipped ruling | fixed | f39ada85e — plan marks them superseded by b055661e4 and gives the deduped counts |
| 4 | review | Lens 3a (low, tiebreak-confirmed): plan `:49` called `archive-merged.js` read only though the branch softened its comment | fixed | f39ada85e — waiver now says no code change, comment softened in d2c1f89d8 |
| 5 | review | Lens 3a (low, tiebreak-confirmed): the measurement scripts live only in a session scratchpad, so nothing in the repo let the next revisit re-derive the counts | fixed | f39ada85e — the ruling paragraph states the counting method (run-id-named dirs, own `session-end` with a `sessionId`, the resume event types) |
| 6 | review | Lens 3a (low, tiebreak can't-tell): the ruling did not disclose that only run-id-named directories were scanned | fixed | f39ada85e — "the 1,856 run-id-named directories" |
