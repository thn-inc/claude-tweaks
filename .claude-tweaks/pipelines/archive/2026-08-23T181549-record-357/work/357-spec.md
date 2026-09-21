---
record: 357
origin: human
risk: medium
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 357: specify/build/design-wrapper: no UI-stack decision point before frontend implementation

Surface: backend

## Current State

- `/claude-tweaks:specify`'s Step 2.5a/2.5c (frontend-detection sniff and design-intent question) and `design-wrapper`'s frontend-detection layer resolve `Surface:` and `Design-intent:` before a frontend build, but neither asks about — nor records — a UI-stack or component-library choice.
- The Pipeline Config Manifesto's Design intent lever governs visual creative direction (bold/quiet/minimal/delightful/onboarding) but has no UI-stack axis alongside it.
- A build agent scaffolding a brand-new frontend from a spec, with no explicit UI-stack signal anywhere in the record or the pipeline config, has no deliberate direction to follow — it defaults to whatever styling approach a copied reference codebase (or ad hoc starting point) happens to use.
- Observed failure: a build defaulted to plain inline styles with no component library, discovered only after the rendered UI was reviewed — adopting a real library (shadcn/ui + Tailwind) at that point meant re-styling already-built components instead of building them right the first time.

## Deliverables

- A UI-stack decision point that surfaces once per project/spec, before frontend implementation begins. Two integration points are candidates — a new lever on the Pipeline Config Manifesto (alongside Design intent, project-wide scope), or an extension of `/claude-tweaks:specify`'s frontend pre-steps (Step 2.5a/2.5c-adjacent in `design-pre-steps.md`, per-record scope). Building this record means judging which granularity actually matches how UI-stack decisions get made in practice (see Gotchas) and picking one, documenting why in the implementation.
- The chosen UI-stack value (component library + styling approach, or an explicit "no preference — defer to reference codebase") propagated downstream — as a body-metadata line or a resolved policy-lever value, read by `/claude-tweaks:build` and `design-wrapper` the same way `Surface:`/`Design-intent:` are read today.
- Auto-mode resolution for the new decision, following the same precedence Step 2.5c already establishes for `Design-intent:` (policy value → apply; explicitly "none" → apply and skip the question; unset → KEPT-PROMPT, ask inline) rather than silently defaulting to whatever a reference codebase or copied component happens to use.
- Documentation of the new field/lever, matching the existing `Design-intent:` pattern — the body-metadata block description in `spec-template.md` if it lands as body-metadata, or the Manifesto's lever enumeration if it lands as a pipeline-config lever.

## Acceptance Criteria

- A frontend-surfaced record shaped by `/claude-tweaks:specify` (`Surface: web`/`mobile`/`desktop`) surfaces a UI-stack question, or reads an already-set project-level UI-stack policy, before `/claude-tweaks:build` scaffolds new frontend code — verified against a project with no prior UI-stack decision and a fresh frontend spec.
- Once set, the UI-stack value is available to `/claude-tweaks:build`/`design-wrapper` as a body-metadata line or resolved policy value, not left to ad hoc inference from a copied reference codebase.
- Backend/infra-surfaced records are unaffected — the new decision point only fires on the same frontend-detection branch that already gates `Design-intent:` (Step 2.5a's sniff, or an explicit `--surface` override).
- Auto mode resolves the UI-stack decision from pipeline config using the same auto/KEPT-PROMPT precedence Step 2.5c already uses for design-intent — it never reaches `/claude-tweaks:build` silently unset when a policy value exists, and never silently invents a default when no policy value exists either.
- Existing specs/records with no UI-stack value keep working unchanged — the field's absence is a valid, non-error state, per this project's expand-contract discipline for contract changes.

## Technical Approach

- Likely landing points: `skills/specify/design-pre-steps.md` (a Step 2.5c-sibling question, if the per-record route is chosen), `skills/specify/spec-template.md` (the new body-metadata field's canonical definition, if body-metadata), `skills/_shared/auto-mode-contract.md` and the Pipeline Config Manifesto (a new lever, if the pipeline-config route is chosen), and `design-wrapper/frontend-detection.md` (documenting the new field/lever's read side, since it's the file that already documents how `Surface:`/`Design-intent:` are read at build time).
- Follow the same auto-mode/KEPT-PROMPT resolution pattern Step 2.5c already establishes for `Design-intent:` rather than inventing a new resolution mechanism for this record.
- Coordinate with any in-flight work touching the same frontend pre-steps or `design-wrapper` contracts (e.g. the design critique dispatch work in #592) to avoid conflicting edits to `design-pre-steps.md` or `frontend-detection.md`.

## Gotchas

- The two candidate integration points are not equivalent in scope. A Manifesto lever is set once per pipeline run and applies pipeline-wide; a `/specify` pre-step question is per-record. Building this record means deciding which granularity actually matches how UI-stack decisions get made in practice — usually a project-level choice made once, rarely a per-record one — before picking an integration point, rather than defaulting to whichever is structurally easier to add.
- A UI-stack value that's too prescriptive (e.g., baking in shadcn/ui + Tailwind as a new universal default) would just replace one silent default with another. The mechanism must genuinely surface a choice — including "no library, plain styles is fine" as a first-class answer — rather than picking a new default answer on the record's behalf.

## Original request

specify/build/design-wrapper: no UI-stack decision point before frontend implementation

**Summary:** When a spec is frontend-facing, the pipeline (`/claude-tweaks:specify`, `/claude-tweaks:build`, and `design-wrapper`'s frontend-detection layer) never asks the user which UI stack or component library to use before implementation happens.

**Kind:** Gap

**Affected component:** `/claude-tweaks:specify`, `/claude-tweaks:build`, `design-wrapper` (frontend-detection layer)

**Use case:** Scaffolding a brand-new frontend app from a spec, with no prior UI-stack decision anywhere in the record or the Pipeline Config Manifesto's policy levers. The build agent had no explicit direction, so it defaulted to whatever styling approach a copied reference codebase happened to use (plain inline styles, no component library) rather than a deliberate choice like shadcn/ui + Tailwind. The user only discovered this after reviewing the rendered UI, at which point adopting a real component library meant re-styling already-built components instead of building them right the first time.

A UI-stack decision seems like it belongs upstream of implementation — alongside (or as an extension of) the Manifesto's existing Design intent lever, or `/claude-tweaks:specify`'s frontend-detection question — surfaced once per project/spec rather than left to whatever an agent happens to default to when copying from a reference source or starting from scratch.

**Plugin version:** 6.79.0

---
Filed via /claude-tweaks:feedback.
<!-- fingerprint: gap-ui-stack-decision-point-before-frontend-build -->

