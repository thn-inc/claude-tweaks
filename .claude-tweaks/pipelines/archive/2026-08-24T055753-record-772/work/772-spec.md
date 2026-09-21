---
record: 772
origin: human
risk: low
size: low
ceremony: standard
grants: [build, merge]
surface: backend
---
# 772: framing-check: weigh supplied ## Gotchas evidence when re-judging a previously-flagged record

Surface: backend

## Current State

`/claude-tweaks:challenge`'s bare-`#N` mode (shipped by #726) appends per-assumption evidence bullets under a record's `## Gotchas` when the human chooses "supply evidence", then clears `solution:unjustified`. But `framing-check` (the mode `/specify` invokes at shaping time) reads only `## Current State`, `## Deliverables`, `## Acceptance Criteria`, and `## Original request` — never `## Gotchas`. Re-shaping a record whose framing text is unchanged therefore re-derives `solution-baked` and re-stamps the label, even when the evidence that justifies the solution now sits in the record. #726's Next Actions line states this honestly, but the evidence the remedy surface collects is structurally invisible to the judge that flagged it.

## Deliverables

- [ ] `skills/challenge/SKILL.md` `framing-check` Step 1 (Gather): also read the body's `## Gotchas` evidence bullets (`- evidence (...)` lines) when present, and Step 2 (Judge): a named assumption whose evidence bullet cites supporting `file:line` counts as cited evidence for the solution it underpins.
- [ ] Keep the ambiguity-resolves-to-`open` rule intact — evidence-aware judging must only ever move a verdict toward `open`, never manufacture a flag.
- [ ] Conformance pin: a test asserting the Gather step names `## Gotchas` evidence bullets.

## Acceptance Criteria

1. A record flagged `solution-baked`, then resolved via `/claude-tweaks:challenge #N` supply-evidence, re-shaped with `/claude-tweaks:specify #N` and an unchanged framing, verdicts `open` when the supplied evidence supports the named solution.
2. A record with no evidence bullets behaves exactly as today.
3. `npm test` green.

## Technical Approach

Extend `framing-check`'s Step 1 (Gather) in `skills/challenge/SKILL.md` to also scan the composed body's `## Gotchas` section for lines matching the `- evidence (...)` shape the bare-`#N` mode writes, and feed them into Step 2 (Judge) as additional signal: a named assumption whose evidence bullet cites a supporting `file:line` counts toward `open`. The bare-`#N` mode's own ambiguity-resolves-to-`open` rule must stay untouched — this only adds a new source of "is there cited evidence" signal, it never adds a new way to flag `solution-baked`.

### Key Files

- `skills/challenge/SKILL.md` — `framing-check` mode's Step 1 (Gather) and Step 2 (Judge)
- a conformance test (location per this repo's existing `skill-prose-conformance-tests` convention) — pins that Step 1's Gather text names `## Gotchas` evidence bullets

## Gotchas

- Widening what counts as evidence must stay one-directional (toward `open` only) — see the skill's own Anti-Patterns table on resolving ambiguity toward `solution-baked` "to be conservative", which is inverted from `assess-agent-autonomy`'s other modes on purpose.
- The evidence-bullet shape (`- evidence ({date}): {classification} — {citation}`) is defined by the bare-`#N` mode in the same skill file — keep the two in sync if that shape ever changes.

## Original request

framing-check: weigh supplied ## Gotchas evidence when re-judging a previously-flagged record

Origin: reflect hindsight from #726
Defer-reason: tangential

## Current State

`/claude-tweaks:challenge`'s bare-`#N` mode (shipped by #726) appends per-assumption evidence bullets under a record's `## Gotchas` when the human chooses "supply evidence", then clears `solution:unjustified`. But `framing-check` (the mode `/specify` invokes at shaping time) reads only `## Current State`, `## Deliverables`, `## Acceptance Criteria`, and `## Original request` — never `## Gotchas`. Re-shaping a record whose framing text is unchanged therefore re-derives `solution-baked` and re-stamps the label, even when the evidence that justifies the solution now sits in the record. #726's Next Actions line states this honestly, but the evidence the remedy surface collects is structurally invisible to the judge that flagged it.

## Deliverables

- [ ] `skills/challenge/SKILL.md` `framing-check` Step 1 (Gather): also read the body's `## Gotchas` evidence bullets (`- evidence (...)` lines) when present, and Step 2 (Judge): a named assumption whose evidence bullet cites supporting `file:line` counts as cited evidence for the solution it underpins.
- [ ] Keep the ambiguity-resolves-to-`open` rule intact — evidence-aware judging must only ever move a verdict toward `open`, never manufacture a flag.
- [ ] Conformance pin: a test asserting the Gather step names `## Gotchas` evidence bullets.

## Acceptance Criteria

1. A record flagged `solution-baked`, then resolved via `/claude-tweaks:challenge #N` supply-evidence, re-shaped with `/claude-tweaks:specify #N` and an unchanged framing, verdicts `open` when the supplied evidence supports the named solution.
2. A record with no evidence bullets behaves exactly as today.
3. `npm test` green.

_Filed by `reflect` via specShapedBody._

