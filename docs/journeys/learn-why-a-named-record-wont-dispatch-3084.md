---
files:
  - plugin/skills/dispatch/SKILL.md
  - plugin/skills/dispatch/queue-pull-script.md
  - plugin/skills/dispatch/not-spec-shaped-exclusion-report.md
  - plugin/skills/dispatch/open-pr-exclusion-report.md
  - plugin/skills/dispatch/blocked-exclusion-report.md
---

# Learn Why a Named Record Won't Dispatch

**Persona:** a maintainer who has just shaped or captured a record, runs `/claude-tweaks:dispatch #N` (or a `#N,#M` list) to build it now, and needs to know what to fix when it doesn't start.
**Goal:** see the actual reason a named record was excluded from this firing, with the command that fixes it, instead of a wrong reason or silence.
**Entry point:** `/claude-tweaks:dispatch #N` or `/claude-tweaks:dispatch #N,#M` naming a record that carries `auto:build` and no `bot:*` label.
**Success state:** the record is reported by the exclusion reason the queue pull actually recorded — `not-spec-shaped` with its `/claude-tweaks:specify #N` (or `/claude-tweaks:tidy` for a missing Release Note only) remedy, `blocked` with its open blocker(s), `open-pr` with the PR number, `target-missing`, or `shipped` — and, in the list form, every other named record still proceeds.

## Steps

### 1. Name the record
- **URL:** `plugin/skills/dispatch/SKILL.md` Step 3, `#N` / `#N[,#M,#O...]` bullets
- **Action:** Run `/claude-tweaks:dispatch #N`. The label checks pass (it has `auto:build`, no `bot:*`), but the queue pull already dropped it from `dispatch-groups.json` before any selection form read that file.
- **Should feel:** Direct — the maintainer named one record and gets one answer about that record.
- **Should understand:** A record can carry every grant and still be ineligible this firing: the queue pull removes candidates for five reasons (`blocked`, `open-pr`, `not-spec-shaped`, `target-missing`, `shipped`) unconditionally, and naming the record does not bypass any of them.
- **Red flags:** Dispatch proceeding to claim a record the queue pull excluded; a generic "not found" with no reason.

### 2. Read the reason by name
- **URL:** `plugin/skills/dispatch/SKILL.md` `#N` bullet; `plugin/skills/dispatch/not-spec-shaped-exclusion-report.md`
- **Action:** Dispatch reads this run's `dispatch-exclusions.json` entry for `#N` and reports its reason, then stops. A not-spec-shaped record reads `#N excluded — not spec-shaped (missing: Release Note). Run /claude-tweaks:tidy.` (or `Run /claude-tweaks:specify #N` for any other missing section or an unresolved placeholder); an open-PR record reads `#N already has an open PR (#pr) — not re-dispatch-eligible until that PR merges or closes`.
- **Should feel:** Actionable — the next command is on the same line as the reason, so there is nothing to look up.
- **Should understand:** The reason shown is the one the queue pull recorded, never inferred; a not-spec-shaped record is never described as having an open PR (#3084's fix — before it, only `open-pr` entries were read).
- **Red flags:** "already has an open PR" for a record with no PR; a `missing:` list that disagrees with the record body; no remedy command.

### 3. Name several records at once
- **URL:** `plugin/skills/dispatch/SKILL.md` `#N[,#M,#O...]` bullet
- **Action:** Run `/claude-tweaks:dispatch #N,#M` where `#N` is excluded and `#M` is eligible. `#N` appears in the `notFound` report with the same named reason as step 2; `#M`'s group proceeds to Step 4.
- **Should feel:** Non-blocking — one excluded record never costs the rest of the list its firing.
- **Should understand:** The list form names reasons exactly as the `#N` form does; the remedy for `#N` can be run while `#M` builds.
- **Red flags:** The whole list aborting over one excluded record; `#N` reported without a reason.

## Origin
- Created during `/claude-tweaks:build` of record #3084 (2026-10-10): the `#N` and `#N,#M` forms now name every exclusion reason that removes a record from `dispatch-groups.json`, including #2829's `not-spec-shaped`.
- Related specs: #2829/#3073 (not-spec-shaped queue-pull exclusion), #1224 (open-PR exclusion), #1983 (target-missing), #1984 (shipped)
- Updated during build of #3103: names `blocked`, the fifth removing exclusion, in Step 1 and the Success state; `blocked-exclusion-report.md` added to `files:`
