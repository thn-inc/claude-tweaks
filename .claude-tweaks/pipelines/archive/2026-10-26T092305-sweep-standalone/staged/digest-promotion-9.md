# Staged: Propose digest cluster — flow (9 entries)

**Source:** digest container #1426, 9 un-promoted entries sharing `{area}` = `flow`.

**Proposed:** file one backlog record absorbing them; on approval append `→ #{new}` to each promoted entry line in #1426.

## Proposed record: Settle 9 below-floor digest findings in flow

### Current State

Digest #1426 holds 9 below-materiality-floor findings in `flow`, accumulated by review/reflect/wrap-up runs and never promoted.

### Deliverables

- [flow] A run dir dispatch minted empty (no config.yml) and flow adopted across dispatch's two-call build+test / review+polish+wrap-up split arrived at the second call with decisions.md/events.jsonl/run-state.json already populated by the first call's build phase, but no config.yml -- flow Step 3's Manifesto appears not to have run (or not to have written config.yml) during the first call despite Step 3 being unconditional; the second call had to initialize config.yml itself on the adopt-empty-run-dir path. — plugin/skills/flow/SKILL.md,plugin/skills/flow/manifesto.md — Defer-reason: pre-existing-outside-diff — 2026-09-13T230428-record-2271
- [flow] A materialized spec's own authored plan commit step (/superpowers:writing-plans output) does not include the plan file itself in its git-add list, diverging from this repo's convention of committing the plan file alongside the first implementation commit; an uncommitted plan file also defeats verify.js's dirty-tree check at review's test gate. — docs/superpowers/plans/*.md, skills/flow/materialize.md — Defer-reason: genuinely-larger — 2026-10-16T073839-record-3068
- [flow] low: re-protect restores status active even for a run that was interrupted before the reconciliation — plugin/skills/flow/worktree-merge.md:152 — Defer-reason: console-backfill-confirmed-low — 2026-10-21T060308-spec-3809
- [flow] low: E1 paragraph restates the hook contract canonical in _shared/git-discipline.md and docs/hooks.md — plugin/skills/flow/worktree-merge.md:44 — Defer-reason: console-backfill-confirmed-low — 2026-10-21T060308-spec-3809
- [flow] (info: checked and within convention (no finding)). — plugin/skills/flow/worktree-merge.md:61 — Defer-reason: console-backfill-confirmed-low — 2026-10-21T060308-spec-3809
- [flow] low: AC2 pinned by phrase presence, not absence of a close instruction — plugin/skills/flow/worktree-merge.md:139 — Defer-reason: console-backfill-confirmed-low — 2026-10-21T060308-spec-3809
- [flow] low: predicted-conflict and git-error routes not distinguished by a test — plugin/skills/flow/worktree-merge.md:87 — Defer-reason: console-backfill-confirmed-low — 2026-10-21T060308-spec-3809
- [flow] 1. **plugin/skills/flow/steps-and-gates.md:62 — conflict paragraph is not scoped to adoption case 1 (medium, agent B only).** The paragraph sits before the five-case list and fires on any pack with `p — plugin/skills/flow/steps-and-gates.md:62 — Defer-reason: console-backfill-confirmed-low — 2026-10-19T174556-record-3014
- [flow] Controller read: the prose quotes the persisted ABORT_REASON literal (never-started: file-overlap group partial claim) accurately; renaming the literal is a contract change, out of scope. — plugin/skills/flow/claim-targets.md:371 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T101533-record-3278

### Acceptance Criteria

- Each Deliverables entry is fixed, or explicitly dropped with a one-line reason in this record.
- Each promoted entry line in #1426 carries `→ #{this record}`.
