---
record: 309
origin: capture
risk: medium
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 309: Veto-window maturation for machine-granted auto:merge

Surface: backend

## Current State

`/claude-tweaks:backlog`'s headless machine-grant mode (`grant`, shipped in #269) applies `auto:merge` immediately once the gate chain in `bin/lib/issues/grant-gate.js` clears every floor via `permittedGrants` (`bin/lib/issues/autonomy.js`) — there is no standing human veto window between a machine grant landing and the record becoming eligible for `/claude-tweaks:dispatch`'s Auto-merge gate (`skills/dispatch/settle-and-merge.md`). Interactive `refine` mode has no such gap, since a human is present at grant time — but the headless path grants and makes a record immediately auto-mergeable in the same breath, with no window for a human to notice and object before the next dispatch firing merges it.

## Deliverables

- [ ] An optional pending grant state (e.g. `auto:merge-pending`) that a headless `/claude-tweaks:backlog grant` firing applies in place of `auto:merge` directly when the gate chain clears — recorded per `_shared/work-record.md`'s label taxonomy (closed per #239 — this leaf is its own documented consumer) and bootstrapped per `_shared/label-bootstrap.md`.
- [ ] A `grant-veto-window-hours` policy key (default `24`), added to `bin/lib/policy-schema.js` following the existing `pr-unarmed-age-hours`/`unsettled-age-hours` pattern (`category: 'merge-safety'`, `tier: 'advanced'`).
- [ ] Maturation logic that promotes a record from the pending state to `auto:merge` once it is older than the veto window and has not been vetoed (veto = a human removes the pending label) — wired into `/claude-tweaks:dispatch`'s existing Auto-merge gate / merge-consult step (`skills/dispatch/settle-and-merge.md`), never a new standalone daemon or cron.
- [ ] `skills/backlog/grant-mode.md` (and any other grant-gate documentation) updated to describe the new pending-then-mature flow, distinct from today's immediate-grant behavior.

## Acceptance Criteria

- [ ] A headless `grant` firing whose gate chain clears applies the pending label instead of `auto:merge` directly, once the veto-window feature is enabled.
- [ ] A record still carrying the pending label and younger than `grant-veto-window-hours` is never matured to `auto:merge` by any dispatch firing in the interim.
- [ ] A record older than `grant-veto-window-hours` and not vetoed is matured to `auto:merge` the next time dispatch's existing settle/merge-consult step runs against it — no separate polling process is introduced.
- [ ] A human removing the pending label before maturation (a veto) permanently prevents that grant from maturing — the record does not silently re-enter the pending state or get re-granted by a later firing without a fresh gate-chain pass.
- [ ] The build explicitly decides and documents whether the veto window is opt-in, default-on, or replaces today's immediate-grant behavior outright — this AC forces that decision, not presupposes an answer.

## Technical Approach

- Extend `bin/lib/issues/grant-gate.js` / `permittedGrants` (`bin/lib/issues/autonomy.js`) so a successful gate-chain pass can emit the new pending state in place of `auto:merge` directly.
- Bind maturation to the existing merge-consult checkpoint dispatch already runs — `skills/dispatch/settle-and-merge.md`'s Auto-merge gate content-judgment step (`assess-agent-autonomy merge-check`) — per this project's own rule against binding a step to an automated event in prose alone (`docs/donts.md`, `[IL-94]`): read the pending label's age against `grant-veto-window-hours` at that existing checkpoint rather than via a new scheduled job.
- Resolve `grant-veto-window-hours` via `resolve-policy.js`, matching how `dispatch-retry-ceiling` and the other `merge-safety` keys are already resolved in `settle-and-merge.md`.

## Gotchas

- The label taxonomy is closed (#239) — confirm during build whether the pending state is cleanest as a new label family or a new value on the existing Grants family, and whether it stacks additively on `auto:build` the same way `auto:merge` does today.
- `_shared/work-record.md`'s Grant semantics state machinery may only ever *remove* grants, never add them, with `/backlog grant`'s headless path named as the sole carve-out for origination. A maturation step that *adds* `auto:merge` from a pending state is a second machine-origination path riding the same carve-out and needs review against that exact permission-matrix row, not a silent extension of it.
- No design doc or brainstorm has scoped this beyond the two related records (#265, #269) — the pending label's final name, whether the veto window interacts with the fleet daily grant cap, and its interaction with the existing retry-ceiling revocation logic are open build-time decisions, not fixed by this record.

## Original request

Veto-window maturation for machine-granted auto:merge

**Related:** #265, #269

Context: The shipped machine-grant unit (#269) applies auto:merge immediately when permittedGrants clears the class — there is no standing human veto between a machine grant and merge eligibility. Surfaced while reviewing the fleet family against the 2026-08-10 autonomy-lanes brainstorm.

Scope: An optional pending state (auto:merge-pending) that dispatch matures to auto:merge at its existing settle/merge-consult step once older than a grant-veto-window-hours policy key (default 24) and not vetoed (veto = a human removes the label). Maturation binds to the existing merge-consult event (IL-94), never a separate daemon; keeps zero-click steady state.

