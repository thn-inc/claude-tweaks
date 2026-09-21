---
record: 991
origin: human
risk: medium
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 991: Enforce record-worktree + PR-early lifecycle stamps structurally, not by bolded prose (recurrence of IL-131)

Surface: backend

Origin: reflect light mode from #893

Defer-reason: tangential

## Current State

`build/SKILL.md` Spec Step 1 already carries explicit, bolded, IL-131-cited "non-skippable" language directing that `build/worktree-setup.md` Step 4.5 (`record-worktree`) and Step 6 (the PR-early draft-PR open, `_shared/pr-early-run-lifecycle.md`) must run before any "is there work to do" judgment can short-circuit them — added by #525 specifically to close IL-131 (record #118, 2026-08-15/16: a build agent's "nothing to implement" judgment swept past both steps). Record #893's build step (2026-08-20) hit the identical trigger — Acceptance Criteria already satisfied by prior work (#902) — and swept past both steps again, despite the prose fix already being in place in the installed skill text. Neither gap logged a `decisions.md` entry (success or documented failure) either, so the miss was silent until `/claude-tweaks:review`/`/claude-tweaks:wrap-up` discovered and backfilled both stamps by hand.

## Deliverables

- Investigate a structural (hook-level or engine-level) enforcement that both sub-steps actually ran, rather than relying on an agent reading and obeying bolded instructional prose under a competing "nothing to implement" judgment — in the spirit of the existing E1 `record-worktree`-ownership enforcement already in this plugin's hooks layer
- Cover both the `record-worktree` stamp and, under `integration-model: pr-first`, the PR-early lifecycle's `run-state.json.pr` field
- Ensure a genuine push/PR-create failure still degrades gracefully (per `_shared/pr-early-run-lifecycle.md`'s existing skip/degrade table) rather than the new enforcement turning a legitimate degrade into a hard block

## Acceptance Criteria

- A build step that judges "no implementation needed" and proceeds to Spec Step 2 without having run Common Step 1 Step 4.5 and (under pr-first) Step 6 is caught mechanically — loud failure or auto-remediation, not a silent skip
- A regression test reproduces this record's and #118's exact trigger (an "already satisfied by prior work" build outcome) and asserts both stamps land
- IL-131's entry in `docs/incident-log.md` is updated to note this second recurrence and link the structural fix, once it exists

## Technical Approach

Since bolded prose already failed to hold twice (IL-131 original + this recurrence), the fix must move enforcement out of agent-read instructions and into something mechanically checked — a hook (in the pattern of the existing E1 `record-worktree`-ownership enforcement) or an engine-level assertion that fails loud if Spec Step 2 is reached without both stamps present. The enforcement must distinguish a genuine, documented degrade (push/PR-create failure, already covered by `_shared/pr-early-run-lifecycle.md`'s skip/degrade table) from a silent skip — only the latter should trip the new mechanism.

## Gotchas

- Two independent recurrences of the identical trigger (an "already satisfied by prior work" judgment) means the fix has to survive a build agent *actively deciding* the steps don't apply, not just a build agent forgetting — a purely prose-based reminder has already failed this test twice.
- Don't let the new enforcement turn a legitimate documented degrade (a real push/PR failure) into a hard block — the existing degrade path in `_shared/pr-early-run-lifecycle.md` must stay reachable.

## Original request

Enforce record-worktree + PR-early lifecycle stamps structurally, not by bolded prose (recurrence of IL-131)

Origin: reflect light mode from #893
Defer-reason: tangential

## Current State

`build/SKILL.md` Spec Step 1 already carries explicit, bolded, IL-131-cited "non-skippable" language directing that `build/worktree-setup.md` Step 4.5 (`record-worktree`) and Step 6 (the PR-early draft-PR open, `_shared/pr-early-run-lifecycle.md`) must run before any "is there work to do" judgment can short-circuit them — added by #525 specifically to close IL-131 (record #118, 2026-08-15/16: a build agent's "nothing to implement" judgment swept past both steps). Record #893's build step (2026-08-20) hit the identical trigger — Acceptance Criteria already satisfied by prior work (#902) — and swept past both steps again, despite the prose fix already being in place in the installed skill text. Neither gap logged a `decisions.md` entry (success or documented failure) either, so the miss was silent until `/claude-tweaks:review`/`/claude-tweaks:wrap-up` discovered and backfilled both stamps by hand.

## Deliverables

- Investigate a structural (hook-level or engine-level) enforcement that both sub-steps actually ran, rather than relying on an agent reading and obeying bolded instructional prose under a competing "nothing to implement" judgment — in the spirit of the existing E1 `record-worktree`-ownership enforcement already in this plugin's hooks layer
- Cover both the `record-worktree` stamp and, under `integration-model: pr-first`, the PR-early lifecycle's `run-state.json.pr` field
- Ensure a genuine push/PR-create failure still degrades gracefully (per `_shared/pr-early-run-lifecycle.md`'s existing skip/degrade table) rather than the new enforcement turning a legitimate degrade into a hard block

## Acceptance Criteria

- A build step that judges "no implementation needed" and proceeds to Spec Step 2 without having run Common Step 1 Step 4.5 and (under pr-first) Step 6 is caught mechanically — loud failure or auto-remediation, not a silent skip
- A regression test reproduces this record's and #118's exact trigger (an "already satisfied by prior work" build outcome) and asserts both stamps land
- IL-131's entry in `docs/incident-log.md` is updated to note this second recurrence and link the structural fix, once it exists

_Filed by `reflect` via specShapedBody._

