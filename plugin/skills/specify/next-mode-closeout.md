# Specify — bare drain: loop termination and close-out

Loaded from `next-mode.md`'s `## Zero eligible or budget exhausted (loop termination + close-out)`
stub (this skill's directory; #2841's split). Read it when that file's Selection fence yields a
`null` `$PICK`, or when this firing's attempt counter reaches `--budget <n>` — never on an
iteration that picked a record. "This fence", "above", and "below" in this file refer to
`next-mode.md`'s reading order at that stub: its Selection section sits above, its `## Claim`
section below.

---

## Zero eligible or budget exhausted (loop termination + close-out)

A `null` result at this fence's `$PICK` path (this iteration's fresh
Eligibility-query fetch, filtered against the this-firing attempted set
above, turned up no candidates) ends the drain loop. **`all`'s
termination condition, stated precisely: the eligible set minus this
firing's attempted set is empty** — not the eligible set alone, since a
record this firing already attempted (any outcome) is permanently
excluded from every later iteration by the attempted-set filter even when
its labels never changed, which is what makes `--budget all` guaranteed
to terminate rather than looping forever on one record whose failure
writes no label. Two distinct cases, by whether this firing has claimed
anything yet (the `shaped`/`routed`/`failed` counts below):

- **Nothing claimed yet** (the very first iteration returns `null`): report
  "nothing eligible this firing" and exit cleanly — no self-report, no
  notification, no close-out rendered. The firing's own session transcript
  line is the only trace, deliberately (mirrors dispatch's "Zero eligible
  groups" posture) — `/claude-tweaks:tidy` and `/claude-tweaks:help`
  surface queue state independently on their own cadence.
- **At least one attempt already ran this firing**: this is the loop's
  normal, successful termination — the eligible set minus this firing's
  attempted set drained to empty before `--budget` was spent (`--budget
  all` can only end this way). Render the close-out below; there is no
  "remaining" line in this case, since nothing is left to attempt.

**Budget exhaustion** ends the loop the same way but with the eligible set
minus this firing's attempted set still non-empty: this firing's attempt
counter (incremented once per successful claim in `## Claim` below)
reaches `--budget <n>` while a fresh fetch, filtered against the attempted
set, still returns a non-`null` pick. Render the close-out below, plus one
line naming the record(s) this firing's ranking would have attempted next
had budget allowed — the top of that final fetch's (already
attempted-set-filtered) ranked list.

**Close-out.** Lead with the three counts, then each bucket's own
accumulated record refs beneath:

```
{shaped: N, routed: M, failed: K}
shaped: #a, #b, ...
routed: #c, ...
failed: #d, ...
remaining (budget exhausted, not attempted this firing): #e, #f, ...
```

- `shaped` — this firing's own Shape-step successes (`next-mode-shape.md`'s
  `## Release`, `shaped: #{n}` reason).
- `routed` — this firing's own Framing Guard routing outcomes
  (`next-mode-shape.md`'s `## Release`, `routed: needs:definition #{n}`
  reason) — a productive outcome, never a failure, per that section.
- `failed` — this firing successfully claimed the record, then
  `next-mode-shape.md`'s Framing Guard or Shape step raised an error
  before completing, **or a shaping-stage guard deliberately refused the
  record without writing any label** (the parent-record guard's tier-2
  headless refusal, inside `next-mode-shape.md`'s own Shape section) —
  both land on the same `## Release`'s `failed: shaping` reason. A
  close-out reader should
  treat `failed` as **"claimed but produced no record change"**, never
  hunt for an exception that may not exist — a deliberate refusal is just
  as valid a `failed` entry as a thrown error. Never a lost claim race
  (`## Claim` below — that consumes no budget and never reaches this
  bucket) and never a Framing Guard routing outcome (that is `routed`,
  never `failed`). Each entry here already filed the shared self-report
  per `next-mode-shape.md`'s Failure self-report section before the loop
  continued past it.
- `remaining` — rendered only on the budget-exhaustion case above; omitted
  entirely when the loop ended because the eligible set emptied.

This close-out is this firing's own report — it renders on every
loop-termination path above (bare drain interactive or headless alike)
except the nothing-claimed-yet no-op, independent of the pre-existing, unchanged "no `## Next Actions` block for
a headless firing" rule (`next-mode-shape.md`'s Shape section) — that rule
governs the separate interactive suggestion-menu render, not this summary.

**Under `--source sweep`,** this firing is a component step of `/claude-tweaks:sweep`
— the close-out counts above render as the step's report to the parent, never a
`## Next Actions`/suggestion-menu render, even with a human present at sweep's own
prompt: the parent owns the handoff. `decisions.md` entries go to the parent's shared
run dir, adopted via the resolution ladder. The `$ATTEMPTED` this-firing set still
resets at firing start exactly as for a Routine firing.
