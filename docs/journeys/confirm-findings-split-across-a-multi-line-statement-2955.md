---
files:
  - plugin/bin/lib/coordination.js
  - plugin/skills/review/step3-lens-dispatch.md
  - plugin/skills/_shared/multi-agent-coordination.md
---

# Confirm Findings Split Across a Multi-Line Statement

**Persona:** a developer who runs `/claude-tweaks:review` (usually inside `/claude-tweaks:flow`) at `medium` effort or above on a diff whose defect sits inside a multi-line call or expression. They read the review summary to decide what to fix before merge.
**Goal:** when both agents of a reproduction pair report the same finding but anchor it on different lines of one multi-line statement, it lands as one `confirmed` finding rather than two `unconfirmed` entries the reviewer has to confirm by hand.
**Entry point:** `/claude-tweaks:review #{n}` (or the `review` phase of `/claude-tweaks:flow #{n}`) on a diff where a finding spans several lines.
**Success state:** the summary's `### Code Review Findings (confirmed)` table lists the finding once. The Review Console's Low-confidence section does not repeat it.

## Steps

### 1. Run a review whose finding spans a multi-line statement
- **URL:** `/claude-tweaks:review #{n}` at `review-effort` `medium` or above
- **Action:** let Step 3 dispatch a lens as a reproduction pair, and both agents flag the same issue. One anchors it on the statement's first line, the other on a later line 3-5 lines below.
- **Should feel:** nothing different during the run. The change is in how `categorise-reproduction` pairs the two reports, not in what the agents are asked or how long the review takes.
- **Should understand:** two findings on the same path pair at line ±2 as before. Beyond that, up to ±5, they pair only when both carry text and their substance similarity is at least 0.2, the same threshold as within ±2 (#3418). Every ±2 pairing is settled first, so a wide-band pair never takes a finding another report placed on the same line.
- **Red flags:** the pair is still split into two `unconfirmed` entries although their text says the same thing. A finding with no text pairs across the wider band.

### 2. Read the confirmed findings — the review summary
- **URL:** the review summary's `### Code Review Findings (confirmed)` table, then the Review Console's Low-confidence section
- **Action:** look for the multi-line finding both agents reported.
- **Should feel:** confident. The finding is confirmed because the two agents agreed, not because the reviewer had to read the source and invoke the direct-verification override.
- **Should understand:** the confirmed entry carries agent A's own line. Two unrelated issues 3-5 lines apart still stay separate `unconfirmed` entries, and a wide-band miss never gets a `nearLocation` pointer. That pointer is kept for a ±2 pair that shares a location but not substance (#1980).
- **Red flags:** the same finding appears once under `confirmed` and again under Low-confidence. Two different issues inside one statement are merged into one confirmed finding. An agent's exact-line match lands in Low-confidence while a farther line is confirmed.

## Origin
- Created during build of #2955. On a `medium`-effort review (plugin 6.133.0), both agents of the error-handling pair flagged a value read inside a multi-line call argument after an external side effect. They anchored it 3 lines apart, so the ±2 rule left 0 confirmed and 2 unconfirmed, and the reviewer confirmed it by hand. The fix added a substance-gated ±5 band to `categoriseReproduction` and paired it in a second pass.
- Related journeys: `confirm-coverage-findings-across-reproduction-pairs-3049.md` (the same matcher, from the prompt side: where agents anchor a coverage gap).
