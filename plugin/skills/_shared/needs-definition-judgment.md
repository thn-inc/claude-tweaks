# `needs:definition` Judgment — needed vs. clear

Shared rubric for `/claude-tweaks:capture` and `/claude-tweaks:feedback`: the same-turn judgment
call that decides whether a filed record names a genuine open choice with no tradeoff made yet
(`needed`) or a single clear ask (`clear`). Both producers cite this file rather than each
inventing its own interpretation of the distinction.

This is a content call, not a structural heuristic — no line-count or keyword check, the same
posture `solution:unjustified`'s judgment takes. See `_shared/work-record.md`'s Definition row for
the label itself and `_shared/label-bootstrap.md` for its bootstrap entry.

The rubric applies to a captured idea (`/claude-tweaks:capture`) or a feedback learning
(`/claude-tweaks:feedback`). Its verdicts are `needed` and `clear`; each producer maps them to its
own variable or rendering.

## Worked examples

- **`needed`** — "Add offline support." Client cache, service worker, and queued sync are all
  viable directions; nothing in the idea picks one. Filing this as-is would ask a builder to
  silently choose an architecture on the filer's behalf.
- **`clear`** — "Fix the date picker showing the wrong timezone on Safari." One well-defined bug,
  one fix. There is no open direction to choose between.
- **`needed`** — "Improve search." Client-side filtering vs. server-side query are both viable,
  and the idea states no tradeoff between them.

## Applying the rubric

Ask: does the idea, as stated, leave more than one viable direction with no tradeoff decided? If
yes, `needed` — file with `needs:definition` and a one-line rationale naming the undecided
directions. If the idea names one clear ask (even if the *implementation* has incidental
sub-decisions), `clear` — file without the label. When unsure, `clear`: `needed` only when the
idea genuinely names an undecided choice.
