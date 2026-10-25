---
files:
  - plugin/skills/dispatch/SKILL.md
  - plugin/skills/dispatch/queue-pull-script.md
  - plugin/skills/dispatch/not-spec-shaped-exclusion-report.md
  - plugin/skills/dispatch/open-pr-exclusion-report.md
  - plugin/skills/dispatch/blocked-exclusion-report.md
  - plugin/skills/dispatch/exclusions-unreadable-report.md
  - plugin/bin/lib/dispatch/exclusions.js
  - plugin/skills/dispatch/neighbour-in-flight-report.md
  - plugin/bin/lib/issues/shipped-candidate.js
  - plugin/bin/lib/issues/linked-prs.js
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
- **URL:** `plugin/skills/dispatch/SKILL.md` `#N` bullet; `plugin/skills/dispatch/not-spec-shaped-exclusion-report.md`; `plugin/skills/dispatch/blocked-exclusion-report.md`; `plugin/skills/dispatch/open-pr-exclusion-report.md`
- **Action:** Dispatch reads this run's `dispatch-exclusions.json` entry for `#N` and reports its reason, then stops. A not-spec-shaped record reads `#N excluded — not spec-shaped (missing: Release Note). Run /claude-tweaks:tidy.` (or `Run /claude-tweaks:specify #N` for any other missing section or an unresolved placeholder); a blocked record reads `1 excluded — blocked by an open dependency: #N (blocked by #x)`; an open-PR record reads `#N already has an open PR (#pr) — not re-dispatch-eligible until that PR merges or closes`.
- **Should feel:** Actionable — the next command is on the same line as the reason, so there is nothing to look up.
- **Should understand:** The reason shown is the one the queue pull recorded, never inferred; a not-spec-shaped record is never described as having an open PR (#3084's fix — before it, only `open-pr` entries were read).
- **Red flags:** "already has an open PR" for a record with no PR; a `missing:` list that disagrees with the record body; no remedy command.

### 2b. The exclusion list itself can't be read
- **URL:** `plugin/skills/dispatch/exclusions-unreadable-report.md`
- **Action:** `#N` clears the label checks, is missing from `dispatch-groups.json`, and has no entry in `dispatch-exclusions.json`. Dispatch runs that file's one-line probe. The probe resolves the session-scoped path itself, then calls `readExclusionsStatus`. When the file is unreadable or not found, dispatch reports `#N — exclusion reason unknown: this firing's dispatch-exclusions.json at {path} could not be read ({error}) … Re-run the queue pull (Step 2), then name #N again.` and stops. When the probe itself fails (non-zero exit, no output, or output with no parseable `status`), dispatch reports the same reason-unknown line with `the status probe failed ({exit code or stderr})` in place of the read result, and stops.
- **Should feel:** Honest. The maintainer is told the reason is unknown rather than being handed a guess.
- **Should understand:** Only a readable file with no entry means "absent from this firing's queue". Step 2 always writes the file, so if it is missing or corrupt at this point, the evidence is gone, not that nothing excluded the record (#3104).
- **Red flags:** A record reported "absent from this firing's queue" while the probe printed `unreadable` or `absent`, or after the probe itself failed; the reason-unknown line without the file path or the re-run remedy.

### 2c. The record dispatches, but a neighbour is mid-build
- **URL:** `plugin/skills/dispatch/neighbour-in-flight-report.md`
- **Action:** `#N` shares a Key File with a record whose claim is live. The queue pull wrote a non-removing `neighbour-in-flight` exclusion, so `#N` is still in `dispatch-groups.json`. Dispatch prints `#N waits — direct neighbour(s) in flight: #m ({files}); bare drain skips it this firing` and then dispatches `#N` anyway.
- **Should feel:** Informed, not refused. Naming the record is the maintainer's override, and the report says what that override risks.
- **Should understand:** Unlike the step 1 reasons, this one never removes the record. Bare drain would wait for the neighbour, but `#N` builds now, and any overlap with `#m` resolves at merge through `_shared/pr-first-merge.md`'s Conflict path (#3278).
- **Red flags:** `#N` refused or reported "absent from this firing's queue" over a neighbour-in-flight entry. The report line missing when a live neighbour exists.

### 2d. A follow-up the PR itself filed is not "shipped" by it
- **URL:** `plugin/skills/dispatch/SKILL.md` False-positive posture (#1984, #4314); `plugin/bin/lib/issues/shipped-candidate.js` `classifyShipped`; `plugin/bin/lib/issues/linked-prs.js` `fetchLinkedPRs` (each mention's `createdAt`)
- **Action:** Name a follow-up record that a PR's own build filed while that PR was open — e.g. `/claude-tweaks:dispatch #4135`, filed at 12:33 by the reflect pass of PR #4035 (opened 08:24, merged 15:39), whose commit message lists it and whose diff covers its Key Files. The queue pull reads each mentioning PR's `createdAt` and skips PR #4035's mention because that PR was opened before the record was created, so `#4135` is not excluded as `shipped`, no Close proposal is staged, and it dispatches.
- **Should feel:** Unremarkable. A record you granted builds when you name it, and you no longer have to drop a false Close proposal by hand at every firing.
- **Should understand:** The `shipped` reason still fires for a PR opened after the record was filed that mentions it and matches its title or covers its Key Files. The new skip is per mention: a later, independent PR can still mark the same record shipped. The accepted cost is a PR that was already open when the record was filed and fixed it with only `refs #N`. That record now builds, and the build finds the work already done (#2502's already-shipped exit).
- **Red flags:** `#4135`, or another follow-up from a still-open PR's build, reported as `shipped` by the PR whose build filed it. A Close proposal staged for it. A record genuinely shipped by a later PR now dispatching.

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
- Updated during build of #3104: Step 2b covers an unreadable or missing `dispatch-exclusions.json`, reported as reason unknown and never as absent; `exclusions-unreadable-report.md` and `exclusions.js` added to `files:`
- Updated during wrap-up of the #3101-#3104 run: Step 2b names the failed-probe branch (#3104 review); Step 2 names the `blocked` report line and visits `blocked-exclusion-report.md` and `open-pr-exclusion-report.md`
- Updated during build of #3278: Step 2c covers the non-removing `neighbour-in-flight` reason. `#N` prints the waits line and still dispatches. `neighbour-in-flight-report.md` added to `files:`
- Updated during build of #4314: Step 2d covers a follow-up record filed during a PR's build, which is no longer read as `shipped` by that PR. `shipped-candidate.js` and `linked-prs.js` added to `files:`
