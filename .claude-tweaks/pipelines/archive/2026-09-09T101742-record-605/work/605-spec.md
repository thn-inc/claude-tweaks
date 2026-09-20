---
record: 605
origin: human
risk: medium
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 605: Distinct bot:parked label for merge-verification parks (split from bot:blocked)

Surface: backend

Origin: /claude-tweaks:review Step 4 hindsight (Capture) — spec 560, run 2026-08-16T101528-spec-559-560

## Current State

#560 gave `bot:blocked` a second meaning: the merge-verification gate parks a run on a red/timed-out PR check WITHOUT revoking `auto:*` (a CI park is not a failure — no Settle classification, no retry increment), while the retry ceiling still applies the same label WITH grant revocation. The definition and consumer sites were migrated (label description, work-record writer table, `github-pr-scan.md`, tidy step-1 Shape 5, backlog refine-mode), and the two states are distinguishable by "grants intact vs removed" — but a distinct label (e.g. `bot:parked`) would make the state legible at a glance and let the `[pr-unarmed]` sweep, `/backlog refine`, and `/tidy` route on it directly instead of inferring it from grant presence.

## Deliverables

- Add `bot:parked` to `_shared/label-bootstrap.md` and `_shared/work-record.md` (Bot state axis).
- Migrate `_shared/pr-first-merge.md` Step 2.5's red path to write `bot:parked` instead of `bot:blocked`.
- Extend the `[pr-unarmed]` sweep exclusion, `/backlog refine`'s re-triage row, `/tidy` Shape 5, and dispatch's queue-pull filters to route on `bot:parked` directly.
- Keep `bot:blocked` for the retry-ceiling case only.
- Update the conformance test that pins the label taxonomy.

## Acceptance Criteria

- A merge-verification park (red/timed-out PR check) writes `bot:parked`, not `bot:blocked`, and leaves `auto:*` grants intact.
- A retry-ceiling park still writes `bot:blocked` and still revokes grants — unchanged behavior.
- `[pr-unarmed]`, `/backlog refine`, `/tidy` Shape 5, and dispatch's queue-pull filters route each state correctly without inferring it from grant presence.
- The label-taxonomy conformance test is updated and green.

## Technical Approach

This is a `_shared/work-record.md` contract change (a label-taxonomy addition) consumed by many skills — follow the project's expand-contract discipline: add `bot:parked` everywhere it's needed before migrating `pr-first-merge.md`'s write path, migrate every listed consumer site, and only then treat `bot:blocked` as retry-ceiling-only. Files: `skills/_shared/label-bootstrap.md`, `skills/_shared/work-record.md`, `skills/_shared/pr-first-merge.md`, `skills/_shared/github-pr-scan.md`, `skills/backlog/refine-mode.md`, `skills/tidy/step-1-records.md`, `skills/dispatch/*`.

## Gotchas

- This is explicitly not a hindsight fix inside #560 — it's a separate record because a label-taxonomy change is a contract change with many consumers, not a same-spec tweak.
- Bootstrap `bot:parked` per `_shared/label-bootstrap.md` before any write path uses it.

## Original request

Distinct bot:parked label for merge-verification parks (split from bot:blocked)

Origin: /claude-tweaks:review Step 4 hindsight (Capture) — spec 560, run 2026-08-16T101528-spec-559-560

## Idea

#560 gave `bot:blocked` a second meaning: the merge-verification gate parks a run on a red/timed-out PR check WITHOUT revoking `auto:*` (a CI park is not a failure — no Settle classification, no retry increment), while the retry ceiling still applies the same label WITH grant revocation. The definition and consumer sites were migrated (label description, work-record writer table, github-pr-scan.md, tidy step-1 Shape 5, backlog refine-mode), and the two states are distinguishable by "grants intact vs removed" — but a distinct label (e.g. `bot:parked`) would make the state legible at a glance and let the `[pr-unarmed]` sweep, `/backlog refine`, and `/tidy` route on it directly.

## Why not now

A label-taxonomy change is a `_shared/work-record.md` contract change consumed by many skills (expand-contract discipline: add, migrate every consumer, remove) — a separate record, not a hindsight fix inside #560.

## Scope sketch

- Add `bot:parked` to `_shared/label-bootstrap.md` + `_shared/work-record.md` (Bot state axis), migrate `_shared/pr-first-merge.md` Step 2.5 red path to write it, extend the `[pr-unarmed]` sweep exclusion, `/backlog refine` re-triage row, `/tidy` Shape 5, dispatch queue-pull filters; keep `bot:blocked` for the retry ceiling only; conformance test update.

Files: skills/_shared/label-bootstrap.md, skills/_shared/work-record.md, skills/_shared/pr-first-merge.md, skills/_shared/github-pr-scan.md, skills/backlog/refine-mode.md, skills/tidy/step-1-records.md, skills/dispatch/*.

