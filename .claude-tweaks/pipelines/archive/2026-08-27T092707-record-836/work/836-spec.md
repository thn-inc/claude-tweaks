---
record: 836
origin: human
risk: low
size: low
ceremony: fast-lane
grants: [build]
surface: backend
---
# 836: init: node_modules permission denial recurred a second time, escalating to a docker-exec workaround with two failed mount-path attempts

Surface: backend

## Current State

The same `node_modules` read-permission denial already reported in #811 (open, unshaped) recurred a second time later in the same session, this time escalating through three distinct workarounds — a fresh `npm install` into scratch, a public-docs web search/fetch, and finally a `docker exec` into a running container, two attempts of which failed on a wrong mount path before the third succeeded. Measured: 8 `node_modules` permission denials across 2 separate clusters in one session; 3 distinct workarounds attempted for the same underlying read; 2 of those workaround attempts themselves failed (wrong container mount path) before one succeeded. As #811 already proposes, `/claude-tweaks:init` should seed a read-only allowlist entry scoped to the resolved dependency roots — explicitly including `node_modules/.pnpm/**`, since that's the path pnpm workspaces actually resolve reads through, not just top-level `node_modules/`. No such entry exists today; the denial recurs identically every time the same file is inspected again.

## Deliverables

- `/claude-tweaks:init` seeds a read-only permission allowlist entry scoped to the project's resolved dependency roots, explicitly covering `node_modules/.pnpm/**` for pnpm workspaces (not just top-level `node_modules/`).
- Re-running `/claude-tweaks:init` on an already-initialized pnpm-workspace project adds the missing entry if absent (a drift-repair path, not just a fresh-init one) — `/claude-tweaks:init`'s own "re-run to find drift, gaps, and stale configuration" contract already covers this class of gap.

## Acceptance Criteria

- A project set up via `/claude-tweaks:init` with a pnpm workspace allows read-only inspection of an installed dependency's type definitions (`node_modules/.pnpm/**`) without a permission prompt or denial.
- Repeating the same inspection later in the same session does not re-trigger the denial — the allowlist entry, once seeded, holds for the rest of the session and future sessions.
- Re-running `/claude-tweaks:init` on a project that already has settings but is missing this entry adds it.

## Technical Approach

This is the same underlying fix #811 already proposes — a read-only allowlist entry in the generated `.claude/settings.json` (or equivalent) scoped to the project's resolved dependency roots. The specific gap this record adds evidence for is the pnpm layout: reads resolve through `node_modules/.pnpm/**`, not just top-level `node_modules/`, so an allowlist entry scoped only to the top-level path would still miss pnpm-workspace reads and reproduce this exact denial. Implement in `/claude-tweaks:init`'s permission/settings scaffolding: detect a pnpm workspace (presence of `pnpm-lock.yaml` or a `.pnpm` directory under `node_modules`) and seed the `.pnpm/**` pattern alongside whatever top-level `node_modules` pattern #811's fix already adds. Wire the same check into `/claude-tweaks:init`'s drift-detection re-run path so an already-initialized project picks up the fix without a full re-init.

### Key Files

- `plugin/skills/init/` — permission/settings scaffolding generation, and the drift-detection re-run path
- `.claude/settings.json` (generated, per-project) — the allowlist entry itself

## Gotchas

- **Likely duplicate of #811** (open, unshaped, same root cause: "init: no generated permission allowlist for read-only inspection of the project's own node_modules"). This record adds a second occurrence in the same session plus a more contorted workaround (docker-exec with two failed mount-path attempts) and the specific pnpm `.pnpm/**` path detail — genuinely additional evidence, not pure noise. Before implementing, reconcile with #811: either fold this record's pnpm-specific detail into #811 and close this one, or keep both and cross-reference explicitly. This overlap was not resolved during shaping — surfaced for human attention rather than silently merged or silently left duplicate.
- The fix must cover `node_modules/.pnpm/**` specifically, not just top-level `node_modules/` — a fix scoped only to the latter would not close this record's own repro (a pnpm workspace's nested layout).
- Plugin version at filing: 6.87.0.

## Original request

init: node_modules permission denial recurred a second time, escalating to a docker-exec workaround with two failed mount-path attempts

**Summary:** The same `node_modules` read-permission denial already reported in #811 recurred a second time later in the same session, this time escalating through three distinct workarounds — a fresh `npm install` into scratch, a public-docs web search/fetch, and finally a `docker exec` into a running container, two attempts of which failed on a wrong mount path before the third succeeded.

**Kind:** Defect

**Affected component:** `/claude-tweaks:init` (generated permission/settings scaffolding)

**Objective:** Friction

**Measurement:** 8 `node_modules` permission denials across 2 separate clusters in one session; 3 distinct workarounds attempted for the same underlying read; 2 of those workaround attempts themselves failed (wrong container mount path) before one succeeded.

**Repro steps:**
1. In a project set up via `/claude-tweaks:init` with a pnpm workspace (nested `node_modules/.pnpm/**` layout), ask the assistant to inspect an installed dependency's own type definitions more than once across a long session.
2. Observe the same class of denial recur each time — nothing about the first denial changes the permission state for the second.
3. Observe the workaround chain lengthen each time as easier options (reinstalling to scratch, reading public docs) are tried and found insufficient before a container detour succeeds.

**Expected vs. actual:**
Expected: as #811 proposes, `/claude-tweaks:init` seeds a read-only allowlist entry scoped to the resolved dependency roots — explicitly including `node_modules/.pnpm/**`, since that's the path pnpm workspaces actually resolve reads through, not just top-level `node_modules/`.
Actual: no such entry exists; the denial recurs identically every time the same file is inspected again.

**Possible duplicate:** #811 (same root cause; this adds a second occurrence in the same session plus a more contorted workaround)

**Definition:** Clear

**Plugin version:** 6.87.0

---
Filed via /claude-tweaks:feedback.
<!-- fingerprint: feedback-7c6beacf -->


**Related:** #811
