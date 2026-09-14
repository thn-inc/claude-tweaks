# Dispatch Step 3 — This Firing's Re-selection Guard

Referenced by `skills/dispatch/SKILL.md` Step 3's Loop. A prior version of that loop assumed
"claimed/Settle-failed groups drop out automatically, via claim or `bot:blocked`" — false for two
real terminal shapes, both leaving a group's labels exactly as eligible as before the attempt:

- A claim-contest/in-flight pre-flight stop (`settle-and-merge.md`'s Claim-contest special case
  explicitly adds neither label, since there was nothing to release or classify).
- An ordinary build/test failure before `dispatch-retry-ceiling` is reached — the record keeps
  `auto:build` for up to two more genuine retries by design.

Without an explicit guard, the very next iteration of the *same* firing re-ranks the identical
group back to the top and reproduces the identical stop, burning the remaining budget on one stuck
record instead of reaching other eligible candidates.

## The rule

After each iteration, append one `{reason: 'firing', records: [number], detail: null}` entry per
that group's member issue number(s) to this run's session-scoped `dispatch-exclusions.json`
(`_shared/session-tmp-root.md`) via `appendExclusion` (`bin/lib/dispatch/exclusions.js` —
`appendExclusion` creates the file on its first call, same as every other reason's producer)
whenever this firing's attempt on that group did **not** end in a live-held or resolved
disposition:

- The first call's status line was not `DONE`/`DONE_WITH_CONCERNS`, or its `OUTCOME` was not
  `build-test-ok` (second call never dispatched) — append now.
- The second call's `OUTCOME` was `failed`/`blocked` — Settle already released the claim, so the
  label-based pre-filter would let the group right back in — append now.

Do **not** append on `merged`/`armed`/`pending-review` (`pr-first`) or `ready-to-merge`
(`local-merge`'s own outcome vocabulary — see `_shared/integration-model.md`): those hold a live
claim (`bot:in-progress`) or are already resolved, so the ordinary claim/label mechanism already
excludes them from the next queue pull. Appending there would be redundant, not wrong — but the
point of this file is the two shapes that mechanism misses.

`next-ranking.md`'s script reads this same file (absent or unreadable treated as `[]`, per
`readExclusions`'s own contract) and, via one `groupIsExcluded(g, entries, ['oversized', 'firing'])`
call, excludes any matching group from the candidate pool — the same derivation that already
excludes an oversized group, not a separate one. `next`'s single-iteration alias never appends
`firing`-reason entries — there is no second iteration in the same firing for it to protect.
