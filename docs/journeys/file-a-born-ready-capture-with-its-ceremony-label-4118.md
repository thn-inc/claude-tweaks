---
files:
  - plugin/skills/capture/SKILL.md
  - plugin/skills/_shared/ceremony-check-invocation.md
  - plugin/skills/_shared/work-record-permission-matrix.md
  - plugin/skills/assess-agent-autonomy/ceremony-check.md
---

# File a Born-Ready Capture That Carries Its Ceremony Label

**Persona:** A claude-tweaks maintainer, or an agent running a release gate or a Wrap-Up Review Console, who files a spec-shaped finding through `/claude-tweaks:capture --source …`. They expect the filed record to be ready to build without a later `/claude-tweaks:specify` pass.
**Goal:** File a `ready` record whose `ceremony:*` label is already decided, so `/claude-tweaks:flow` and the express and driver lanes read the label instead of judging again.
**Entry point:** `/claude-tweaks:capture --source {origin} …` with a spec-shaped body, which takes the Shaped-body branch.
**Success state:**
- The new record carries `ready`, its `risk:*`/`size:*` labels, and one of `ceremony:fast-lane` or `ceremony:standard`.
- Capture's presentation line names the ceremony it stamped.
- A later `/claude-tweaks:flow #{n}` writes no `Manifesto ceremony-check` line for it, because the label is the value.

## Steps

### 1. File the finding
- **URL:** the `/claude-tweaks:capture` output in the session
- **Action:** Run the capture. In step 3 of the Shaped-body branch, capture judges ceremony through `_shared/ceremony-check-invocation.md` as a bare `ceremony-check` (the record has no number yet) and passes the verdict to `recordPayload` as `ceremony`.
- **Should feel:** Like one filing. The judgment is part of the same step that scores risk and size, with no extra prompt.
- **Should understand:** `/capture` co-owns `ceremony:*` on this branch only (`_shared/work-record-permission-matrix.md`). A stub capture or a `needs:definition` record stays label-free.
- **Red flags:** A `ready` record filed through `--source` with `risk:*`/`size:*` labels but no `ceremony:*` label and no failure note in capture's output.

### 2. Read the stamped label
- **URL:** the new GitHub issue's labels, and capture's presentation line `(… risk:{r} size:{s}, ceremony:{c}, ready)`
- **Action:** Check that the label and the presentation line agree.
- **Should feel:** Settled. The ceremony is decided once, where the record is shaped.
- **Should understand:** The label now decides lane eligibility. A capture judged `fast-lane` can take the express lane. One judged `standard` leaves the driver lane by default, because `allowAbsentCeremony` only ever relaxed an absent label.
- **Red flags:** A `ceremony:standard` capture admitted by the driver lane while `express-driver-review` is not `on`.

### 3. If the ceremony check gave no verdict
- **URL:** capture's presentation line
- **Action:** Read the note that the ceremony check failed and the record was filed without a ceremony label.
- **Should feel:** Unblocked. The filing still happens, and the gap is stated, not hidden.
- **Should understand:** A failed, stalled or verdict-less check is never treated as `standard`. The unlabeled record falls back to `/flow`'s Manifesto judgment, as before this change. The payload omits the `ceremony` key in this case, because `null` makes `recordPayload` throw.
- **Red flags:**
  - The filing retried or stopped because of the ceremony check.
  - A `ceremony:standard` label stamped on a record whose check printed no `CEREMONY:` line.

## Origin
- Created during build of #4118 (`/capture`'s born-ready branch filed `ready` records with no `ceremony:*` label, so every one paid `/flow`'s ceremony-check fallback).
- Related: `docs/journeys/run-flow-on-an-unlabeled-record-3160.md`; `docs/decisions/0006-ceremony-tiering-owned-by-specify.md` (2026-11-25 note).
