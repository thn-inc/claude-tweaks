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
  (architecture, flowchart, sequence, state, ER, tree, and seven other types) from this project's
  own `DESIGN.md` tokens, and is already invoked as a soft-hook by `/journeys`, `/specify`, and
  `/review` — not only standalone.
- `plugin/skills/specify/decomposition-mode.md`'s Step 2.5d ("Diagram Suggestion") already folds
  diagram suggestions into `/specify`'s own output, for every surface (backend and infra
  included, not just frontend): it scans the design doc and decomposed record titles against a
  structural-signal table (state machines, ER schemas, multi-actor sequences, branching
  flowcharts, multi-component architectures, parent-child taxonomies), emits up to two
  recommendations with a ready-to-run `/claude-tweaks:visualize {type} {spec-slug} --source
  specify` command, and places them under a `### Diagram suggestions` block in the Step 9
  summary. It already respects this repo's own `diagram-suggestions: enabled` CLAUDE.md flag, and
  is purely advisory — it never blocks decomposition and never auto-invokes `/visualize`.

The one real gap found: Step 2.5d's hook fires during `/specify`'s *design-doc decomposition*
path, not for a single record's *implementation plan* written by `/superpowers:writing-plans`.
There is no existing hook suggesting a diagram for an individual record's execution plan — the
narrower claim #2689's Deliverables actually named ("folding visual-plan-style diagramming into
`/specify` **or** `/writing-plans` output").

**Prototype.** As the record's own Technical Approach specified, one in-flight record was used as
the prototype subject — #2689 itself, since it was already being specified and built. Its text
spec (`.claude-tweaks/pipelines/2026-10-03T173920-record-2689/work/2689-spec.md`) and its
implementation plan (`docs/superpowers/plans/2026-10-03-visual-plan-evaluate-prototype.md`) were
both produced through the existing pipeline unchanged. A companion visual-plan artifact was then
hand-authored for the same record's plan, following `/visualize`'s own baseline-path construct
(`plugin/skills/_shared/visual-html-output.md`'s core-fragment/wrapper pattern) rather than a new
mechanism: `docs/plans/2689-visual-plan-flowchart.html` — a four-box flowchart of this record's
own evaluate → prototype → decide flow, themed from this repo's `DESIGN.md` tokens.

## Decision

**Visual-plan diagramming stays opt-in via `/claude-tweaks:visualize`. It does not become a
standing, always-run step in `/specify` or `/superpowers:writing-plans`.**

The existing design is already correct for the common case: `/specify`'s Step 2.5d only suggests
a diagram when a structural signal actually matches (3+ components, a named state machine, a
multi-table schema, and so on), and it caps itself at two suggestions per design doc. A mandatory
step would instead run — and cost a model turn plus file write — on every plan regardless of
whether a diagram adds any value, which contradicts the structural-signal gating the existing
hook already uses. The prototype in this record confirms the manual path is cheap and fast when a
diagram is actually warranted (one hand-authored SVG fragment, reusing an existing themed
wrapper), so there is no efficiency case for forcing it into every build.

This record did **not** extend Step 2.5d (or add an equivalent step) to `/superpowers:writing-plans`
for single-record implementation plans, despite that being the one real gap found above. The gap
is real, but closing it is a separate, narrower follow-up (a small addition to an existing hook's
trigger surface), not a reason to build a new "/visual-plan" skill — filed as a backlog idea
rather than folded into this record's scope, per the record's own instruction to keep the
prototype scoped to one record.

## Alternatives considered

- **Build a new `/visual-plan` skill wrapping both the text spec and a diagram in one unified
  output.** Rejected: duplicates `/visualize` + Step 2.5d's existing structural-signal detection
  and themed rendering, with no described capability the two together don't already provide.
- **Promote Step 2.5d (or a clone of it) to a mandatory step in `/writing-plans`, always emitting
  a diagram for every plan.** Rejected: fires regardless of whether a diagram would help,
  inverting the existing advisory, signal-gated design for no demonstrated review-speed gain.
- **Extend Step 2.5d's trigger surface to also cover `/writing-plans`-authored single-record
  plans, closing the one real gap.** Not rejected — plausible future work — but out of scope for
  this record; captured as a follow-up idea rather than built here, consistent with keeping this
  record's prototype scoped to one record.

## Consequences

No code or skill behavior changes as a result of this record. `/claude-tweaks:visualize` and
`/specify`'s Step 2.5d continue exactly as before. The prototype artifact
(`docs/plans/2689-visual-plan-flowchart.html`) demonstrates the opt-in path is usable today for
any record's plan, by hand, without new tooling.

Revisit if a future record demonstrates review speed or clarity actually suffers from the
opt-in boundary found here — at which point extending Step 2.5d's trigger surface to
`/writing-plans`-authored plans (the one real gap this record identified) is the narrower
follow-up to pursue first, before a new standing skill.
