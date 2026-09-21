---
record: 496
origin: human
risk: low
size: low
ceremony: fast-lane
grants: []
surface: infra
---
# 496: review: confirm #360's parent-AC-forwarding instruction actually surfaces in a live per-task SDD dispatch prompt

Surface: infra

## Current State

#360 (merged via PR #492, 2026-08-15) added an instruction to `skills/build/SKILL.md`'s `**subagent** (default):` paragraph directing `/build` to forward the parent spec's Acceptance Criteria excerpt to `/superpowers:subagent-driven-development`'s per-task review dispatches. #360's own Acceptance Criterion 4 required this be verified in a real composed dispatch prompt, not just confirmed by inspecting the instruction text in `skills/build/SKILL.md`.

During the 7-spec multi-record `/flow` run that shipped #360, every one of the 7 specs was small enough (1-3 files, size:low) that direct implementation was used instead of dispatching through `/superpowers:subagent-driven-development`, so AC4 was never exercised. A second real opportunity occurred 2026-09-05 (record #1537, run `2026-09-05T132902-record-1537`): its `decisions.md` confirms an actual `/superpowers:subagent-driven-development` dispatch happened (its scratch directory `.superpowers/sdd/2026-09-05-claude-md-auto-mode-contract-drift-fix/` was created and later cleaned up per that run's own Cleanup step), but nothing in that run's `decisions.md` captured whether the per-task dispatch prompt actually carried the parent AC excerpt, and the scratch directory holding the real prompt is already deleted (gitignored, swept by that run's own cleanup). AC4 is still unverified two occurrences later — the instruction text remains correctly placed and worded by inspection, but nobody has yet captured live proof it lands in a real dispatch prompt.

## Deliverables

Next time a `/flow` or `/build` run's plan has 2+ tasks and genuinely reaches `/superpowers:subagent-driven-development` dispatch, capture one per-task review dispatch prompt (before its scratch directory is cleaned up) and confirm it carries the parent spec's Acceptance Criteria excerpt, not just the task's own brief.

## Acceptance Criteria

- A captured, real per-task dispatch prompt from a live `/superpowers:subagent-driven-development` invocation is checked for the parent spec's AC excerpt.
- If present: close this record, citing the confirming run id and pointing at the captured prompt text (or its location) as evidence.
- If absent: this is a real gap in `/build`'s Common Step 2 — file it as its own fix-shaped record rather than silently leaving the instruction unverified again.

## Technical Approach

No code change by default — this is a verification task. Watch for the next `/flow`/`/build` run whose plan dispatches 2+ tasks through `/superpowers:subagent-driven-development` (the SDD scratch directory appears at `.superpowers/sdd/{run-slug}/` during the run, before cleanup) and read one per-task dispatch prompt from that live session before the scratch directory is swept. If `/build`'s Common Step 2 needs a fix, the change lands in `skills/build/SKILL.md`'s `**subagent** (default):` paragraph itself.

### Key Files

- `plugin/skills/build/SKILL.md` — the `**subagent** (default):` paragraph carrying the AC-forwarding instruction; only edited if verification finds a real gap
- `.superpowers/sdd/{run-slug}/` — ephemeral per-run scratch directory holding the actual dispatch prompts; must be read *during* the triggering run, before its own cleanup step deletes it

## Gotchas

- The evidence window is narrow: `/superpowers:subagent-driven-development`'s own scratch directory is gitignored and routinely cleaned up by the triggering run's own Cleanup step (confirmed on record #1537) — capture the prompt live, during the run, not after.
- Two occurrences (the #360 batch, record #1537) have now passed without AC4 being exercised; if a third occurrence also passes unverified, consider whether the verification step itself needs to be made a standing part of `/build`'s own procedure rather than relying on someone remembering to check.

## Original request

review: confirm #360's parent-AC-forwarding instruction actually surfaces in a live per-task SDD dispatch prompt

Trigger: the next `/claude-tweaks:flow` (or standalone `/claude-tweaks:build`) run whose plan genuinely dispatches `/superpowers:subagent-driven-development` for 2+ tasks.

## Context

#360 (merged via PR #492, 2026-08-15) added an instruction to `skills/build/SKILL.md`'s `**subagent** (default):` paragraph directing `/build` to forward the parent spec's Acceptance Criteria excerpt to `/superpowers:subagent-driven-development`'s per-task review dispatches. #360's own Acceptance Criterion 4 required this be verified in a *real composed dispatch prompt*, not just confirmed by inspecting the instruction text in `skills/build/SKILL.md`.

During the 7-spec multi-record `/flow` run that shipped #360, every one of the 7 specs (including #360 itself) was small enough (1-3 files, size:low) that I implemented directly rather than dispatching through `/superpowers:subagent-driven-development` — a deliberate, disclosed shortcut for that batch's actual scope, but it means AC4 was never exercised live. The instruction text is correctly placed and worded (verified by inspection), but nobody has yet observed it landing inside a real per-task reviewer's dispatch prompt.

## What to do

Next time a `/flow` or `/build` run's plan has 2+ tasks and genuinely reaches `/superpowers:subagent-driven-development` dispatch, capture one per-task review dispatch prompt and confirm it carries the parent spec's Acceptance Criteria excerpt (not just the task's own brief). If it does — close this record, noting the confirming run. If it doesn't — that's a real gap in `/build`'s Common Step 2, worth its own fix.

Filed via retroactive reflect pass, standalone `/claude-tweaks:wrap-up` (2026-08-15), after the #360 multi-spec batch merged.

