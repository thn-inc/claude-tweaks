# Specify — Diagram Suggestion (shared detection rules)

Signal-detection table and emission rules for suggesting a `/claude-tweaks:visualize` diagram
from a block of text — cited by `decomposition-mode.md`'s Step 2.5d (the design doc text plus
decomposed record titles) and `shaping-mode-readback.md`'s Diagram suggestion section (a single
shaped record's own composed body, or each record's in a comma-list batch). One detection table,
cited rather than restated, so the two modes' recommendations never drift (#2949).

## Gate

Read the `diagram-suggestions` flag from CLAUDE.md (written by `/init` Step 12, under its
`## Design integration` heading). When the flag is `disabled` or missing, skip the whole step
silently — no scan, no block, no log line. Both callers apply this gate before running Detection
below, never after.

## Detection

Scan the given text for structural signals. Use this detection table:

| Signal in the text | Diagram type (suggest) |
|----------------------|------------------------|
| Phrases like "state machine", "states:", "transitions from … to …", named status enums (3+ values) | `state` |
| Schema definitions, `entity`, `references`, `foreign key`, ORM relations between 2+ tables | `er` |
| 3+ services / actors / queues exchanging messages or HTTP calls | `sequence` |
| 3+ named branches in a decision (`If A then B; if C then D; otherwise E`) | `flowchart` |
| 3+ system components / boxes in a layout (microservices, layers, gateways) | `architecture` |
| Parent-child taxonomy with 2+ levels (categories → subcategories → items) | `tree` |

Emit at most **two** recommendations — the two strongest matches. Skip emission entirely if no signal matches (trivial records and refactors should not trigger the hook).

## Output format

For each emitted recommendation:

```
**Diagram suggestion:** This design doc describes a state machine for orders
(pending → paid → shipped → delivered → refunded). Consider a state diagram:
`/claude-tweaks:visualize state {spec-slug} --source specify`
```

`{spec-slug}` is the caller's own identifier for what's being visualized — the design doc's slug
for a decomposition-mode caller, the record's own ref/slug for a shaping-mode caller.

## Rendering — render and log are independent axes

Advisory only — never blocks, never writes record frontmatter, never invokes a tool itself. The
calling mode decides placement. Render and log are **independent** conditions, not an either/or
choice — evaluate both, every time:

- **Render** the recommendation(s) inline whenever a human is present at this turn to read
  them — in whatever block the calling mode's own render step specifies. The user decides
  whether to act in the next turn.
- **Log** the STAGED line to the decision log whenever a pipeline run directory resolved for
  this invocation (`$RUN_DIR` / `$PIPELINE_RUN_DIR`) — independent of whether rendering also
  happened:

  `STAGED {time} — {step-id}: diagram-suggestion ({type}) for {ref-or-slug}. Reversibility: high.`

  `{step-id}` is the calling mode's own step/section name (`Step 2.5d` for decomposition mode,
  `Diagram suggestion` for shaping mode) — each caller supplies its own; this file does not fix
  one.
- A posture with no human present and no run directory logs nothing and renders nothing — there
  is nothing to do.

Decomposition mode's `auto` runs are the case this independence exists for: an `auto`
decomposition run typically has both a run directory (so it logs) **and** a human reading the
Step 9 summary afterward (so it also renders) — both outputs fire together, never one in place
of the other.
