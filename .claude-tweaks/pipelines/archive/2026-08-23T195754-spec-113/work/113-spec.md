---
record: 113
origin: human
risk: low
size: low
ceremony: fast-lane
grants: []
surface: backend
---
# 113: /tidy has no scan step for orphaned ledger files in docs/plans/

Surface: backend

## Current State

`/claude-tweaks:ledger` creates per-feature ledger files at `docs/plans/*-ledger.md`. `/claude-tweaks:wrap-up` Step 10 deletes them on successful completion — but a pipeline that never reaches wrap-up leaves its ledger behind permanently, and nothing sweeps for it.

`/tidy`'s own Relationship table already states this plainly:

> /tidy does not currently scan ledger files — no step in `scan-procedures.md` reads `docs/plans/*-ledger.md`, so a stale or orphaned ledger left behind by a pipeline that never reached wrap-up is not surfaced by a `/tidy` sweep today.

Re-verified 2026-08-23 (tidy live-recheck of this record's own park trigger): `docs/plans/` currently holds roughly 49 `*-ledger.md` files. At least three have no matching directory under `.claude-tweaks/pipelines/` (present or archived) at all:

- `2026-08-14-392-delete-consumerless-code-ledger.md`
- `2026-08-14-record-390-ledger.md`
- `2026-08-14-record-422-ledger.md`

The original three example ledgers cited when this record was filed (2026-08-03: `2026-07-14-unified-work-record-ledger.md`, `2026-07-19-archival-ordering-fix-ledger.md`, `2026-07-19-flow-dependency-header-ledger.md`) are gone from disk now — but the orphan population simply replaced itself with a new set, confirming the underlying gap is still live, not closed. This is a documented-but-unclosed gap, not an unknown one.

## Deliverables

- A scan step (or an extension of the existing Step 4 plans scan, which already globs `docs/superpowers/plans/` and `~/.claude/plans/` in the main thread) that globs `docs/plans/*-ledger.md`.
- Orphan criteria: the ledger's matching pipeline run directory is absent from `.claude-tweaks/pipelines/` (or present only under `archive/`), and no open work record references it.
- A `[ledger]` output prefix wired into the Step 6 report and the Action Vocabulary's existing Delete routing.
- The three ledgers listed above (2026-08-14-dated) resolved as the first pass.

## Acceptance Criteria

- A `/claude-tweaks:tidy` run with the relevant scope surfaces every orphaned `docs/plans/*-ledger.md` as a `[ledger]` finding with a Delete or Keep recommendation.
- A ledger belonging to a still-active pipeline run is **not** flagged.
- `/tidy`'s Relationship row for `/claude-tweaks:ledger` is updated — it currently documents the absence of this scan and would become wrong.
- `skills/tidy/scan-procedures.md` and the Scope Selection table stay consistent with whichever step number is used.

## Technical Approach

### Key Files

- `skills/tidy/SKILL.md` — Scope Selection table, scan-steps table, Relationship row
- `skills/tidy/scan-procedures.md` — the new or extended scan step
- `skills/tidy/step-6-auto.md` — aggressiveness routing row for the new finding type

Step 4 already runs in the main thread precisely because its rule set is a small glob, so extending it is cheaper than adding a parallel agent.

## Gotchas

- Deleting a ledger whose pipeline is merely paused (not abandoned) destroys unresolved-item state that `/wrap-up`'s Step 8.5 gate depends on. Absence of the run directory is the safer signal than file age alone.
- `/wrap-up` Step 10 remains the normal deletion path — this scan is a backstop for runs that never got there, not a replacement.

## Original request

/tidy has no scan step for orphaned ledger files in docs/plans/

**Trigger:** A `/claude-tweaks:tidy` sweep is being extended, or an orphaned ledger is noticed on disk again.

## Current State

`/claude-tweaks:ledger` creates per-feature ledger files at `docs/plans/*-ledger.md`. `/claude-tweaks:wrap-up` Step 10 deletes them on successful completion — but a pipeline that never reaches wrap-up leaves its ledger behind permanently, and nothing sweeps for it.

`/tidy`'s own Relationship table already states this plainly:

> /tidy does not currently scan ledger files — no step in `scan-procedures.md` reads `docs/plans/*-ledger.md`, so a stale or orphaned ledger left behind by a pipeline that never reached wrap-up is not surfaced by a `/tidy` sweep today.

Verified 2026-08-03: `grep -rn "ledger" skills/tidy/` returns only that Relationship row — no scan step reads the path. Three orphaned ledgers are sitting in `docs/plans/` right now:

- `2026-07-14-unified-work-record-ledger.md`
- `2026-07-19-archival-ordering-fix-ledger.md`
- `2026-07-19-flow-dependency-header-ledger.md`

This is a documented-but-unclosed gap, not an unknown one.

## Deliverables

- A scan step (or an extension of the existing Step 4 plans scan, which already globs `docs/superpowers/plans/` and `~/.claude/plans/` in the main thread) that globs `docs/plans/*-ledger.md`.
- Orphan criteria: the ledger's matching pipeline run directory is absent from `.claude-tweaks/pipelines/` (or present only under `archive/`), and no open work record references it.
- A `[ledger]` output prefix wired into the Step 6 report and the Action Vocabulary's existing Delete routing.
- The three ledgers listed above resolved as the first pass.

## Acceptance Criteria

- A `/claude-tweaks:tidy` run with the relevant scope surfaces every orphaned `docs/plans/*-ledger.md` as a `[ledger]` finding with a Delete or Keep recommendation.
- A ledger belonging to a still-active pipeline run is **not** flagged.
- `/tidy`'s Relationship row for `/claude-tweaks:ledger` is updated — it currently documents the absence of this scan and would become wrong.
- `skills/tidy/scan-procedures.md` and the Scope Selection table stay consistent with whichever step number is used.

## Technical Approach

### Key Files

- `skills/tidy/SKILL.md` — Scope Selection table, scan-steps table, Relationship row
- `skills/tidy/scan-procedures.md` — the new or extended scan step
- `skills/tidy/step-6-auto.md` — aggressiveness routing row for the new finding type

Step 4 already runs in the main thread precisely because its rule set is a small glob, so extending it is cheaper than adding a parallel agent.

## Gotchas

- Deleting a ledger whose pipeline is merely paused (not abandoned) destroys unresolved-item state that `/wrap-up`'s Step 8.5 gate depends on. Absence of the run directory is the safer signal than file age alone.
- `/wrap-up` Step 10 remains the normal deletion path — this scan is a backstop for runs that never got there, not a replacement.

## Original request

Surfaced by `/claude-tweaks:wrap-up` reflection (record #89 wrap-up, 2026-08-03) as a deferred insight. Three orphaned ledgers were observed on disk while confirming this run had no ledger of its own.

