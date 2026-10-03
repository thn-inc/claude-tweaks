# 0021. Visual-plan diagramming stays opt-in via `/visualize`, not a standing `/specify` step

- **Status:** accepted
- **Date:** 2026-10-03
- **Context:** #2689 (evaluate-then-prototype record)

## Context

#2689 asked whether claude-tweaks should grow a "/visual-plan"-style skill — generating a rich,
visual implementation plan alongside the text spec, inspired by a similar feature described for
other coding agents. Before building anything new, the record's own Gotchas required checking
whether this was already substantially solved.

It is. Two existing pieces already cover the described value:

- `plugin/skills/visualize/SKILL.md` already generates themed, self-contained HTML+SVG diagrams
  (15 types — architecture, flowchart, sequence, state, ER, tree, and nine others) from this
  project's own `DESIGN.md` tokens, and is already invoked as a soft-hook by `/journeys`,
  `/specify`, and `/review` — not only standalone.
- `plugin/skills/specify/decomposition-mode.md`'s Step 2.5d ("Diagram Suggestion") already folds
  diagram suggestions into `/specify`'s **decomposition-mode** output (design doc → sub-records),
  for every surface (backend and infra included, not just frontend): it scans the design doc and
  decomposed record titles against a structural-signal table (state machines, ER schemas,
  multi-actor sequences, branching flowcharts, multi-component architectures, parent-child
  taxonomies), emits up to two recommendations with a ready-to-run `/claude-tweaks:visualize
  {type} {spec-slug} --source specify` command, and places them under a `### Diagram suggestions`
  block in the Step 9 summary. It already respects this repo's own `diagram-suggestions: enabled`
  CLAUDE.md flag, and is purely advisory — it never blocks decomposition and never auto-invokes
  `/visualize`.

**The gap found is wider than "just `/writing-plans`."** `grep -rli diagram
plugin/skills/specify/*.md` matches only `decomposition-mode.md`, `decomposition-mode-closeout.md`,
and `mechanical-handoff.md` — all decomposition-mode-only files. `/specify`'s **shaping mode**
(a bare `#N` reference, shaping one existing record in place — the path most records go through,
including #2689 itself) has no diagram hook at all, and neither does `/superpowers:writing-plans`
when it writes a single record's implementation plan. So the real gap is shaping mode **and**
writing-plans output, not only the narrower "or `/writing-plans`" framing #2689's own Deliverables
used.

**Prototype.** As the record's own Technical Approach specified, one in-flight record was used as
the prototype subject — #2689 itself, since it was already being specified and built. Its text
spec (GitHub issue #2689, materialized to this run's own pipeline directory) and its
implementation plan (`docs/superpowers/plans/2026-10-03-visual-plan-evaluate-prototype.md`) were
both produced through the existing pipeline unchanged. A companion visual-plan artifact was then
hand-authored for the same record's plan: `docs/plans/2689-visual-plan-flowchart.html` — a
four-box flowchart of this record's own evaluate → prototype → decide flow, themed from this
repo's `DESIGN.md` tokens. It follows `/visualize`'s baseline-path SVG+token-binding conventions
(`plugin/skills/_shared/visual-html-output.md`) but is a simplified one-off, not a strict
implementation of that file's core-fragment/wrapper split: the token `:root` blocks live in the
page's `<head>`, not packaged alongside the `<svg>` as a separately reusable core fragment, so a
bare markdown-embed of just the SVG (never produced here) would render with undefined color
variables. The standalone file this record actually produces is unaffected and renders correctly.

**No review-speed or clarity comparison was performed.** The record's own Deliverables asked for
one ("see whether it improves review speed over the current text-only plan"); this prototype
produced the artifact but did not measure or compare anything against it. The chosen subject — a
linear four-step chain — is also not a diagram Step 2.5d's own detection table would have
suggested on its own (its `flowchart` signal requires 3+ *named branches* in a decision, not a
linear sequence), so this prototype cannot speak to whether diagrams help on the inputs the
existing hook actually targets.

## Decision

**Visual-plan diagramming stays opt-in via `/claude-tweaks:visualize`. It does not become a
standing, always-run step in `/specify` or `/superpowers:writing-plans`.**

Step 2.5d's existing design is already right for the case it covers: it only suggests a diagram
when a structural signal actually matches (3+ components, a named state machine, a multi-table
schema, and so on), and it caps itself at two suggestions per design doc. A mandatory step would
instead run — and cost a model turn plus file write — on every plan regardless of whether a
diagram adds any value, inverting the structural-signal gating the existing hook already uses,
with no measured evidence (see "No review-speed or clarity comparison was performed" above) that
forcing it into every plan would pay for itself.

This record did **not** extend Step 2.5d (or add an equivalent step) to `/specify`'s shaping mode
or to `/superpowers:writing-plans`, despite that being the real gap found above. The gap is real,
but closing it is a separate, narrower follow-up (a small addition to an existing hook's trigger
surface), not a reason to build a new "/visual-plan" skill — filed as GitHub issue #2949
(`Defer-reason: tangential`) rather than folded into this record's scope, per the record's own
instruction to keep the prototype scoped to one record.

## Alternatives considered

- **Build a new `/visual-plan` skill wrapping both the text spec and a diagram in one unified
  output.** Rejected: duplicates `/visualize` + Step 2.5d's existing structural-signal detection
  and themed rendering, with no described capability the two together don't already provide.
- **Promote Step 2.5d (or a clone of it) to a mandatory step in `/specify` shaping mode and
  `/writing-plans`, always emitting a diagram for every plan.** Rejected: fires regardless of
  whether a diagram would help, inverting the existing advisory, signal-gated design — and this
  record performed no review-speed/clarity comparison to justify the added cost (see Context).
- **Extend Step 2.5d's trigger surface to also cover `/specify` shaping mode and
  `/writing-plans`-authored single-record plans, closing the real gap.** Not rejected — plausible
  future work — but out of scope for this record; filed as issue #2949 rather than built here,
  consistent with keeping this record's prototype scoped to one record.

## Consequences

No code or skill behavior changes as a result of this record. `/claude-tweaks:visualize` and
`/specify`'s Step 2.5d continue exactly as before. The prototype artifact
(`docs/plans/2689-visual-plan-flowchart.html`) demonstrates the opt-in path is usable today for
any record's plan, by hand, without new tooling.

Revisit if a future record demonstrates review speed or clarity actually suffers from the
opt-in boundary found here — at which point extending Step 2.5d's trigger surface to `/specify`
shaping mode and `/writing-plans`-authored plans (issue #2949, the gap this record identified) is
the narrower follow-up to pursue first, before a new standing skill.
