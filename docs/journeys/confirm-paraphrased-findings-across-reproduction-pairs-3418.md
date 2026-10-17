---
files:
  - plugin/bin/lib/coordination.js
  - plugin/skills/review/step3-lens-dispatch.md
---

# Confirm Paraphrased Findings Across Reproduction Pairs

**Persona:** a developer who runs `/claude-tweaks:review`, usually inside `/claude-tweaks:flow`, at `medium` effort or above, and reads the review summary to decide what to fix before merge.
**Goal:** when both agents of a reproduction pair find the same defect but word it differently, or cite it at nearby lines such as a definition and its use, it lands as one `confirmed` finding. It should not arrive as two `unconfirmed` entries the reviewer has to confirm by reading the source.
**Entry point:** `/claude-tweaks:review #{n}`, or the `review` phase of `/claude-tweaks:flow #{n}`, on a diff large enough that each lens runs as a reproduction pair.
**Success state:** the summary's `### Code Review Findings (confirmed)` table lists the defect once. The Review Console's Low-confidence section does not repeat it, and no direct-verification override was needed to confirm it.

## Steps

### 1. Run a review where both agents find the same defect — any session
- **URL:** `/claude-tweaks:review #{n}` with `review-effort` set to `medium` or above
- **Action:** let Step 3 dispatch each lens as a reproduction pair. Two agents with byte-identical prompts each report the same defect independently.
- **Should feel:** nothing different during the run. The change is in what each agent is told and in how `categorise-reproduction` pairs the two reports. The review does not take longer or ask anything new.
- **Should understand:**
  - Each lens agent's prompt carries the defect-anchor rule next to the file-native `Path:Line` rule. A finding is reported at the line where the defect itself is, not at a caller, a use site, or the first line of the enclosing block.
  - When the defect spans several copies, the finding goes at the first occurrence: the earliest line in the first file the review bundle lists.
  - Coverage findings follow their own anchor rule (#3049).
- **Red flags:**
  - One agent cites a duplicated block from one file and its partner cites a copy in another file.
  - The anchor rule shows up inside the byte-pinned Calibration/Output-template block.

### 2. Read the confirmed findings — the review summary
- **URL:** the review summary's `### Code Review Findings (confirmed)` table, then the Review Console's Low-confidence section
- **Action:** look for the defect both agents reported, worded in two different ways.
- **Should feel:** confident. The finding is confirmed because the two agents agreed. Nobody had to spend source reads elevating it through the direct-verification override.
- **Should understand:**
  - Within ±5 lines on the same path, a pair is matched on one named substance threshold (`SUBSTANCE_SIMILARITY_MIN`, 0.2) of token similarity, so paraphrases of one defect pair. Every ±2 pairing is settled before the 3-5 line band, and a pair with no text pairs only within ±2.
  - Two different defects reported at the same location still stay separate: each `unconfirmed` entry carries a `nearLocation` pointer at the other.
- **Red flags:**
  - The same defect is still split into two `unconfirmed` entries although both texts name it.
  - Two genuinely different defects on one line are merged into one confirmed finding, so one of them silently disappears.

## Origin
- Created during the build of #3418. On #3375's `medium`-effort review, `categorise-reproduction` confirmed only 2 of the 13 findings both agents reported. Every miss was an anchor or wording disagreement, and recovering them cost about ten main-thread source reads.
- The fix recalibrated the matcher from 0.4 within ±2 and 0.6 for 3-5 lines to one 0.2 threshold across ±5. Over 152 archived lens pairs, confirmed findings rose from 28 to 54, and no hand-labelled different-defect pair merged. The fix also added the defect-anchor rule to the lens dispatch prompt.
- Related journeys: `confirm-findings-split-across-a-multi-line-statement-2955.md` (the ±5 band) and `confirm-coverage-findings-across-reproduction-pairs-3049.md` (the coverage anchor rule).
