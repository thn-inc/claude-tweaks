---
files:
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/review/review-summary-template.md
---

# See a Partial Outcome in the Full Review Summary

**Persona:** A claude-tweaks maintainer running `/claude-tweaks:review` (directly, or inside `/claude-tweaks:flow #N`) on a record whose `## Current State` names the callers, gates or user-visible outcome the change exists to fix. They read the review's summary to decide whether to merge.
**Goal:** When the diff meets every acceptance criterion but never reaches the outcome the record named, the summary says so in its full form instead of reading as a clean pass.
**Entry point:** `/claude-tweaks:review` Step 1 item 5 (Current-State outcome reach) marks the outcome `partial` on a run where every deliverable is `done` and every criterion `met`.
**Success state:** Step 7 renders the full review template, whose Spec Compliance section and verdict name the unreached outcome as a gap; no `PASS (clean)` heading appears.

## Steps

### 1. Watch Step 1 mark the outcome partial
- **URL:** `plugin/skills/review/code-mode-steps.md` Step 1, item 5 and its Gate table.
- **Action:** Review checks whether the diff reaches at least one caller, gate or outcome the spec's `## Current State` names, or whether the spec's `## Gotchas` names the follow-up record that wires them. When neither holds, it marks the outcome `partial` even though every criterion is `met`.
- **Should feel:** Like an ordinary minor gap. The review flags it and proceeds; it does not block.
- **Should understand:** A `partial` outcome counts toward the Gate like a partial deliverable — the change can be correct and still not fix what the record was filed for.
- **Red flags:** An outcome left unmarked because every criterion is `met`. A `partial` outcome that blocks the review instead of proceeding as a minor gap.

### 2. Read the full summary, not the compact clean PASS
- **URL:** The review summary Step 7 renders (`plugin/skills/review/review-summary-template.md`).
- **Action:** Step 7 picks the compact form only when every condition the template's "Compact form — clean PASS" list names holds, spec compliance and the Current-State outcome included. A `partial` outcome fails the "Step 1 item 5's Current-State outcome is not `partial`" condition, so Step 7 renders the full template.
- **Should feel:** Visible. The gap sits in the summary the maintainer already reads, next to the Spec Compliance tables and the verdict.
- **Should understand:** The compact form only drops empty scaffolding. A run with a known gap always gets the full template, whether the gap is in a deliverable, a criterion or the outcome.
- **Red flags:** A `## Review: … — PASS (clean)` heading on a run whose Step 1 marked the outcome `partial`. Step 7's own one-line summary of the compact conditions naming a shorter list than the template's.

## Origin
- Created during build of #5359. Before it, the compact form's conditions named `partial`, `missing` and `unverifiable` deliverables and criteria but not Step 1 item 5, and Step 7 summarized the compact conditions as "zero findings, zero actions, and zero manual steps", so a run that met every criterion without reaching its record's outcome could still render the compact clean PASS. Pinned by `tests/review-compact-pass-outcome-conformance.test.js`.
