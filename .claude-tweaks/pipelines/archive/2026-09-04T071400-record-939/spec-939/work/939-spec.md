---
record: 939
origin: capture
risk: medium
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 939: wrap-up Auto-merge short-circuit skips ledger-file deletion — ~20 resolved ledgers stranded on main

Surface: backend

Origin: discovered during #845's wrap-up (review-console.md's Auto-merge short-circuit fast-lane merge path) while independently verifying cleanup completeness

Defer-reason: genuinely-larger

## Current State

`wrap-up/review-console.md`'s Auto-merge short-circuit (the fast-lane path a dispatched singleton's `merge-check` verdict routes through) explicitly bypasses `/claude-tweaks:wrap-up`'s Phase 4 execution step, re-implementing only acceptance labeling (`verification-brief.md`) and Section E (issue claim release + grant removal) itself — see that file's "Order is load-bearing" and "Release-reason mapping" notes. It does **not** re-implement `cleanup-procedures.md`'s canonical item 2 (Open items ledger — "Delete via `/ledger`'s delete operation, only after Phase 3's ledger gate confirms zero open items"). The result: every record that merges via this short-circuit leaves its fully-resolved `docs/plans/{date}-{spec}-ledger.md` file permanently on `main`, un-deleted, even though the resolve gate already confirmed zero open items before the merge.

Verified directly in this repo's current `docs/plans/`: 21 `*-ledger.md` files present, 20 of which have zero remaining `| open |` rows (fully resolved) — e.g. `2026-08-17-record-711-ledger.md` (merged via "Wrap-up: open items ledger for record #711 — residue sweep's own-PR finding, accepted, refs #711", 0 open rows) and, after this run, `2026-08-19-record-845-ledger.md` (0 open rows, merged via PR #935). These are not in-progress — they are stale audit trail that item 2 exists specifically to clean up, sitting on `main` indefinitely because the one merge path that skips Phase 4 entirely never runs it.

## Deliverables

- [ ] In `wrap-up/review-console.md`'s Auto-merge short-circuit section, add a step (alongside the existing Section E re-implementation) that runs cleanup item 2 — delete the resolved ledger file via `/claude-tweaks:ledger`'s delete operation — before or as part of the merge, consistent with item 2's own stated precondition (Phase 3's gate already ran by the time this short-circuit is reached).
- [ ] Decide and document ordering: item 2's deletion should land in the same commit/push that the merge carries (so the ledger file never survives on `main` past the merge that resolved it), matching how item 2 behaves on the normal (non-short-circuit) Phase 4 execution path.
- [ ] One-time backlog cleanup: delete the ~20 already-stranded, fully-resolved `docs/plans/*-ledger.md` files currently on `main` (verify each has zero `| open |`/`| deferred |`-without-terminal-status rows before deleting; do not touch the one file with a genuinely open item found during this record's audit).

## Acceptance Criteria

1. A record merged via the Auto-merge short-circuit no longer leaves its resolved ledger file on `main` after the merge.
2. `tests/` (or a new test) pins that the short-circuit's procedure text includes the ledger-deletion step, the same way other cleanup-completeness contracts in this codebase are pinned.
3. The pre-existing stranded ledger files are cleaned up (or explicitly triaged and kept with a stated reason, if any turn out to have residual value as audit trail).

## Technical Approach

Add the missing ledger-deletion step to `wrap-up/review-console.md`'s Auto-merge short-circuit section, immediately alongside its existing Section E re-implementation (issue claim release + grant removal) — the short-circuit already re-implements the specific cleanup-procedures.md items it needs rather than calling back into Phase 4 wholesale, so item 2 (ledger deletion) gets the same one-off re-implementation treatment. Precondition is already satisfied by the time the short-circuit is reached (Phase 3's gate confirmed zero open items), so the new step is purely mechanical: invoke `/claude-tweaks:ledger`'s delete operation on the run's ledger file, landing the deletion in the same commit/push the merge carries — matching item 2's existing behavior on the normal Phase 4 path, so no new ordering semantics are introduced, only a bypassed one is restored. Pin the addition with a test asserting the short-circuit's procedure text includes the ledger-deletion step, following whatever cleanup-completeness pinning convention this codebase already uses for its other short-circuit re-implementations. For the one-time backlog cleanup, re-audit each of the ~20 stranded `docs/plans/*-ledger.md` files at execution time (state may have shifted since this record's own audit) — delete only files confirmed to have zero `| open |` rows and no deferred item lacking a terminal status, and explicitly document any file kept instead of deleted.

### Key Files

- `plugin/skills/wrap-up/review-console.md` — Auto-merge short-circuit section; add the ledger-deletion step
- `plugin/skills/wrap-up/cleanup-procedures.md` — canonical item 2, the pattern to mirror
- `plugin/skills/ledger/SKILL.md` — delete operation invoked by the new step
- `docs/plans/*-ledger.md` — the ~20 stranded files for the one-time cleanup
- `tests/` — new pinning test for the short-circuit's procedure text

## Gotchas

- `review-console.md` explicitly notes "Order is load-bearing" for the Auto-merge short-circuit — the new ledger-deletion step must respect whatever ordering constraint already governs Section E's re-implementation; don't assume the new step is order-independent just because it's mechanically simple.
- The one-time backlog cleanup (Deliverable 3) must re-verify zero-open-items per file at execution time, not trust this record's own audit snapshot — state may have shifted between filing and execution. This record explicitly found one file with a genuinely open item during its own audit; do not delete that file, and re-check for others like it.
- Deferred as `genuinely-larger` from #845's wrap-up — this fix touches a load-bearing merge-path ordering contract plus a bulk one-time cleanup, correctly scoped as separate follow-up work rather than fixed inline during #845.

## Original request

wrap-up Auto-merge short-circuit skips ledger-file deletion — ~20 resolved ledgers stranded on main

Origin: discovered during #845's wrap-up (review-console.md's Auto-merge short-circuit fast-lane merge path) while independently verifying cleanup completeness

Defer-reason: genuinely-larger

## Current State

`wrap-up/review-console.md`'s Auto-merge short-circuit (the fast-lane path a dispatched singleton's `merge-check` verdict routes through) explicitly bypasses `/claude-tweaks:wrap-up`'s Phase 4 execution step, re-implementing only acceptance labeling (`verification-brief.md`) and Section E (issue claim release + grant removal) itself — see that file's "Order is load-bearing" and "Release-reason mapping" notes. It does **not** re-implement `cleanup-procedures.md`'s canonical item 2 (Open items ledger — "Delete via `/ledger`'s delete operation, only after Phase 3's ledger gate confirms zero open items"). The result: every record that merges via this short-circuit leaves its fully-resolved `docs/plans/{date}-{spec}-ledger.md` file permanently on `main`, un-deleted, even though the resolve gate already confirmed zero open items before the merge.

Verified directly in this repo's current `docs/plans/`: 21 `*-ledger.md` files present, 20 of which have zero remaining `| open |` rows (fully resolved) — e.g. `2026-08-17-record-711-ledger.md` (merged via "Wrap-up: open items ledger for record #711 — residue sweep's own-PR finding, accepted, refs #711", 0 open rows) and, after this run, `2026-08-19-record-845-ledger.md` (0 open rows, merged via PR #935). These are not in-progress — they are stale audit trail that item 2 exists specifically to clean up, sitting on `main` indefinitely because the one merge path that skips Phase 4 entirely never runs it.

## Deliverables

- [ ] In `wrap-up/review-console.md`'s Auto-merge short-circuit section, add a step (alongside the existing Section E re-implementation) that runs cleanup item 2 — delete the resolved ledger file via `/claude-tweaks:ledger`'s delete operation — before or as part of the merge, consistent with item 2's own stated precondition (Phase 3's gate already ran by the time this short-circuit is reached).
- [ ] Decide and document ordering: item 2's deletion should land in the same commit/push that the merge carries (so the ledger file never survives on `main` past the merge that resolved it), matching how item 2 behaves on the normal (non-short-circuit) Phase 4 execution path.
- [ ] One-time backlog cleanup: delete the ~20 already-stranded, fully-resolved `docs/plans/*-ledger.md` files currently on `main` (verify each has zero `| open |`/`| deferred |`-without-terminal-status rows before deleting; do not touch the one file with a genuinely open item found during this record's audit).

## Acceptance Criteria

1. A record merged via the Auto-merge short-circuit no longer leaves its resolved ledger file on `main` after the merge.
2. `tests/` (or a new test) pins that the short-circuit's procedure text includes the ledger-deletion step, the same way other cleanup-completeness contracts in this codebase are pinned.
3. The pre-existing stranded ledger files are cleaned up (or explicitly triaged and kept with a stated reason, if any turn out to have residual value as audit trail).

_Filed by `capture` via specShapedBody._

