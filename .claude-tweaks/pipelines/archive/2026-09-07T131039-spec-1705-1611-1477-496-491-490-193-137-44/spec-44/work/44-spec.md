---
record: 44
origin: human
risk: low
size: medium
ceremony: standard
grants: []
surface: infra
---
# 44: New-skill candidate: cross-terminal smoke test for claude-tweaks' own GitHub-issues pipeline

Surface: infra

## Current State

A live cross-terminal smoke test of capture -> specify -> triage -> dispatch (2026-07-22) surfaced two real bugs (missing work-backend config, a silently-skipped triage audit-log write) and six process optimizations, all fixed same-session. This exact machinery (claim refs, bot:in-progress, ceremony tiers, label taxonomy) got two rounds of fixes in one session, and nothing else in the plugin currently re-verifies it end-to-end. Ad hoc conversational testing worked but required designing the whole multi-terminal plan from scratch each time.

This candidate passed harness-health's new-skill qualification gate 3-of-3 (reusability, complexity, project-specificity) during a `/claude-tweaks:wrap-up` reflection pass: reusability met (this machinery got 2 rounds of fixes in one session), complexity met (safe cross-session orchestration plus claim-race verification plus cleanup is non-trivial), project-specificity met (entirely specific to claude-tweaks' claim-ref/label-taxonomy/ceremony-tier machinery).

## Deliverables

A dedicated skill that orchestrates cross-session integration testing of the pipeline: fires capture/specify/triage/dispatch through genuinely isolated sessions (real terminals or equivalent), deliberately exercises the claim-race path (two concurrent dispatch attempts on one record), verifies outcomes against live git/gh state rather than trusting agent narration, caps blast radius (e.g. a harmless test payload, or a stop-before-build mode), and cleans up test artifacts (worktrees, claim refs, test issues) afterward.

## Acceptance Criteria

- The new skill can fire capture -> specify -> triage -> dispatch across genuinely isolated sessions (not simulated within one conversation) and report pass/fail per stage against live git/gh state.
- The claim-race path (two concurrent dispatch attempts on one record) is deliberately exercised at least once per run, with the outcome verified against live claim-ref state, not agent self-report.
- Blast radius is capped: the skill either uses a harmless, clearly-labeled test payload, or supports a stop-before-build mode that exercises the pipeline machinery without a real build landing.
- Test artifacts (worktrees, claim refs, test issues/records) are cleaned up after a run, verified by checking their absence afterward, not merely by the cleanup step reporting success.
- `npm test` passes (no regression to the existing suite from the new skill's own supporting code).

## Technical Approach

Model this as a new `plugin/skills/{name}/` skill following this repo's existing skill-authoring conventions (`docs/skill-authoring.md`), since it's a genuinely new orchestration capability, not an extension of an existing skill's scope. The isolation mechanism (real terminals vs. an equivalent simulated-but-genuinely-separate-session approach) is the first design decision to make, since "genuinely isolated" is the acceptance bar the 2026-07-22 ad hoc test met by construction (real multi-terminal setup) but a future automated version needs its own answer for. Verification against live git/gh state (not agent narration) should reuse this project's existing `gh`/git read patterns (`gh-api-module-pattern` skill) rather than inventing a new verification mechanism. Cleanup should mirror `/claude-tweaks:tidy`'s own worktree/claim-ref cleanup patterns where they already exist, rather than reimplementing them.

### Key Files

- `plugin/skills/{new-skill-name}/SKILL.md` - the new skill's definition, following `docs/skill-authoring.md`'s conventions
- `plugin/skills/_shared/gh-api-module-pattern.md` - reference for the gh/git verification pattern this skill should reuse rather than reinvent
- `docs/skill-graph.md` - add this skill's edges once named and scoped

## Gotchas

- This record's Trigger condition ("the capture -> specify -> dispatch machinery takes another round of bug fixes") may have already fired more than once since this record was parked (2026-08-07) - re-check recent bug-fix history on this machinery before scoping the build, since additional recent defect classes may belong in the smoke test's own coverage.
- "Genuinely isolated sessions" is doing real work in the Acceptance Criteria - a simulated-but-not-actually-separate approach would not meet the bar the original ad hoc test met, and the design should not quietly substitute a weaker isolation mechanism for convenience.
- Blast-radius capping and cleanup verification are both named explicitly in Acceptance Criteria because the whole point of this skill is to safely exercise real claim-race and dispatch machinery - an unsafe or leaky test harness for this specific machinery is worse than no automated coverage at all.

## Original request

New-skill candidate: cross-terminal smoke test for claude-tweaks' own GitHub-issues pipeline

**Trigger:** The capture -> specify -> dispatch machinery takes another round of bug fixes, i.e. the class of defect this smoke test exists to catch recurs.

**Parked:** 2026-08-07, during a backlog park sweep. Nothing about the underlying problem changed — this record was on hold in substance and is now labelled that way.

---

**Related:** #43

Context: A live cross-terminal smoke test of capture->specify->triage->dispatch (2026-07-22) surfaced two real bugs (missing work-backend config, a silently-skipped triage audit-log write) and six process optimizations, all fixed same-session. This exact machinery (claim refs, bot:in-progress, ceremony tiers, label taxonomy) got two rounds of fixes in one session, and nothing else in the plugin currently re-verifies it end-to-end. Ad hoc conversational testing worked but required designing the whole multi-terminal plan from scratch each time.

Scope: A dedicated skill that orchestrates cross-session integration testing of the pipeline: fires capture/specify/triage/dispatch through genuinely isolated sessions (real terminals or equivalent), deliberately exercises the claim-race path (two concurrent dispatch attempts on one record), verifies outcomes against live git/gh state rather than trusting agent narration, caps blast radius (e.g. a harmless test payload, or a --claim-only-style stop before build), and cleans up test artifacts (worktrees, claim refs, test issues) afterward. Passed the harness-health new-skill qualification gate 3-of-3 (reusability, complexity, project-specificity) during /claude-tweaks:wrap-up reflection this session.

Gate result: Reusability met (this machinery got 2 rounds of fixes in one session). Complexity met (safe cross-session orchestration + claim-race verification + cleanup is non-trivial). Project-specificity met (entirely specific to claude-tweaks' claim-ref/label-taxonomy/ceremony-tier machinery).



