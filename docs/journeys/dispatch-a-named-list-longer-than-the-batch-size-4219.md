---
files:
  - plugin/bin/lib/issues/grouping.js
  - plugin/skills/dispatch/SKILL.md
  - plugin/skills/dispatch/near-duplicate-pairs.md
---

# Dispatch a Named List Longer Than the Batch Size

**Persona:** a maintainer who picks four records from the backlog, puts the one that matters most first, and runs `/claude-tweaks:dispatch #A,#B,#C,#D` while `dispatch-batch-size` is 3.
**Goal:** have the records build in the order they were named, and know exactly which named record waits for a later firing.
**Entry point:** `/claude-tweaks:dispatch #4026,#4028,#4032,#4029`, all four carrying `auto:build` and no `bot:*` label, with `dispatch-batch-size: 3`.
**Success state:** #4026, #4028 and #4032 dispatch in that order, and the firing's report says `#4029 deferred by dispatch-batch-size (3) — name it in a later firing`; #4029 is left unclaimed.

## Steps

### 1. Name the records in the order you want them built
- **URL:** `plugin/skills/dispatch/SKILL.md` Step 3, `#N[,#M,#O...]` bullet; `plugin/bin/lib/issues/grouping.js` `selectGroupsForExplicitList`
- **Action:** Run `/claude-tweaks:dispatch #4026,#4028,#4032,#4029`. Dispatch calls `selectGroupsForExplicitList(numbers, groups, 3)`, which places each group at the earliest position any of its members holds in the list. Step 2's pool order does not decide the selection.
- **Should feel:** Predictable. The order typed is the order built.
- **Should understand:** Ranking never runs for a named list, so the named order is the priority. A fast-lane bundle holding #4028 and a later-named record sorts at #4028's position (#4219).
- **Red flags:** The selection following pool order, so a later-named record builds first; the first-named record being the one the cap leaves out.

### 2. Read which record the cap left out
- **URL:** `plugin/skills/dispatch/SKILL.md` `#N[,#M,#O...]` bullet
- **Action:** The cap keeps the first three ordered groups. Dispatch reports each requested record in the returned `deferredByCap` list as `#4029 deferred by dispatch-batch-size (3) — name it in a later firing`, and leaves it unclaimed in the queue.
- **Should feel:** Accounted for. Every named record is either dispatched, excluded with a reason, or deferred by the cap, and none is dropped silently.
- **Should understand:** A cap-deferred record is not an exclusion. It still carries its grant and is eligible, and only the firing's batch size held it back. To build it next, name it again or raise `dispatch-batch-size`.
- **Red flags:** A named record missing from the report entirely; a cap-deferred record shown with an exclusion reason; a deferred record that ends up claimed.

### 3. See the predicted-conflict line for the records that dispatch
- **URL:** `plugin/skills/dispatch/near-duplicate-pairs.md` step 2
- **Action:** Before Step 4, dispatch runs `predictedConflicts` over `selectedGroups` exactly as returned. The list is already capped, so a near-duplicate pair involving the deferred #4029 prints no line.
- **Should feel:** Relevant. The merge-order warning covers only what is about to build.
- **Should understand:** The announced merge order is the named order, because Step 5 dispatches `selectedGroups` in the order returned.
- **Red flags:** A predicted-conflict line naming a record that did not dispatch this firing.

## Origin
- Created during `/claude-tweaks:build` of record #4219 (2026-10-25). Explicit-list selection now follows the named order, `selectGroupsForExplicitList` applies the `dispatch-batch-size` cap itself, and every requested record the cap leaves out is reported as deferred. Observed 2026-10-24: `#4026,#4028,#4032,#4029` at batch size 3 had left out #4026, the first-named record, without reporting it.
- Related: #3520 (predicted-conflict line, `docs/journeys/dispatch-a-near-duplicate-pair-by-name-3520.md`), #3084 (named exclusion reasons, `docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md`)
