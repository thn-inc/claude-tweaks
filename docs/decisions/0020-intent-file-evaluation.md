# 0020. No separate intent file ahead of the work record

- **Status:** accepted (the option was rejected)
- **Date:** 2026-09-30
- **Context:** #2685 (evaluate adopting an Intent.MD-style pre-build intent file)

## Context

Anthropic's "The AI-native SDLC playbook" (claude.com blog, 2026-08-21) opens its artifact chain with `intent.md`: intent.md → spec.md → plan.md → PR → deployment. The person who owns the problem writes it, usually by brainstorming with Claude. A product owner reviews and corrects it before it is committed. It lives in a version-controlled home, suggested as an `intent/` folder in the product repo. The playbook's example has five parts: the problem, the proposed outcome, the affected users and systems, the constraints, and open questions. Secondhand write-ups add `Status` and `Owner` header lines and describe the sections as illustrative, not a fixed template. The playbook's stated rationale is to capture intent once, in the originator's own words, as a version-controlled artifact the next stage can act on without a handoff.

The record asks whether claude-tweaks should adopt such a file, for example as a precursor to `/claude-tweaks:specify`. The record linked a Medium article; it refused automated fetches (HTTP 403), so this evaluation reads the playbook it cites directly.

## Decision

**Do not adopt a separate intent file.** claude-tweaks already captures every part of intent.md, in one artifact that also carries the later stages: the work record. A second file ahead of it would split one source of truth into two.

Field by field, against what `/claude-tweaks:capture` and `/claude-tweaks:specify`'s shaping mode already produce:

| intent.md part | Where claude-tweaks already holds it |
|---|---|
| Problem | `## Current State` — required and non-empty (`_shared/work-record.md`'s spec-shaped-body check) |
| Proposed outcome | `## Deliverables` plus `## Acceptance Criteria` — also required |
| Affected users and systems | `Surface:` and `Design-intent:` metadata (`specify/shaping-mode-stamping.md`), plus `### Key Files` for the systems touched. Named personas arrive later, in `docs/journeys/` |
| Constraints | `## Technical Approach` and `## Gotchas` |
| Open questions | The `## Open Question` body variant (`bin/lib/issues/record.js`), which lands the record `needs:definition` rather than `ready` |
| Status | Stage labels: `needs:definition` / `ready`, `bot:in-progress`, and closure on merge |
| Owner / originator's own words | The record's author and `origin:` provenance, plus `## Original request`. That section is preserved byte-exact under the shaped body and is the record's ground truth (`specify/shaping-mode.md`) |
| Product-owner review before commit | `ready` and the grant gate: a record is built only after the spec-shaped-body check and an explicit `grants:` authorization |
| Version-controlled home | The work backend: GitHub issues (edit history), or `local-files` records inside the repo |

The playbook's own goal, capturing intent once and handing it to the next stage without a rewrite, is exactly what the `/capture` → `/specify` path does. `/specify` shapes the same record in place rather than transcribing it into a new file. `/capture`'s own anti-pattern table already rules out the alternative: capturing an idea that already has a spec "duplicates intent across two files".

## Alternatives considered

- **Adopt `intent/*.md` as a precursor file that `/specify` reads.** Rejected. Every field would be re-typed into the record `/specify` produces, and the two copies drift. This is the same failure mode behind the one-edge-one-place rule for `docs/skill-graph.md`. It would also add a stage between an idea and a `ready` record in a pipeline whose whole design is to shorten that path (`/capture`'s born-ready chain).
- **Make the record body itself follow intent.md's section names.** Rejected. The four required sections are a shipped contract. `_shared/work-record.md`'s spec-shaped-body check verifies them, and `/claude-tweaks:backlog refine` and the grant gate both re-run that check. Renaming them for vocabulary parity is a breaking contract change with no capability gained.
- **Adopt only intent.md's "affected users" section.** Not adopted now. It is the one part without a dedicated record section: personas appear only after build, in journeys. But no build in the run history is on record as failing for want of a persona stated up front, so adding a required section on that basis would be speculative. Revisit under the condition below.

## Consequences

**Easy:** nothing changes. Existing records, the `/capture` → `/specify` flow, and every consumer of the record body are untouched. There is no follow-up implementation record, because the decision is not to adopt.

**Given up:** interoperability with teams that standardize on a literal `intent/` folder. A claude-tweaks user in such a team still has the file, just not as a pipeline input. The way to bridge that is to capture the file's content (`/claude-tweaks:capture`, then `/claude-tweaks:specify`), not to read it in place.

**Revisit if** Anthropic's tooling begins reading `intent/*.md` natively (a Claude Code convention, not a blog playbook), which would make the file an input other tools depend on. Or if reviews repeatedly trace a defect to a record that never named who the work was for, which would justify an "affected users" section on the record itself, not a separate file.
