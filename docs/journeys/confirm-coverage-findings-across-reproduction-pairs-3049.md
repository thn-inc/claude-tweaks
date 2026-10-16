---
files:
  - plugin/skills/review/step3-lens-dispatch.md
---

# Confirm Coverage Findings Across Reproduction Pairs

**Persona:** a developer who runs `/claude-tweaks:review` (usually inside `/claude-tweaks:flow`) at `medium` effort or above on a change whose production guard is only exercised by a gated or missing test. They read the review summary to decide what to fix before merge.
**Goal:** when both agents of the 3f Test Quality reproduction pair find the same coverage gap, it lands as a `confirmed` finding in the review summary rather than as two `unconfirmed` entries that need the reviewer's override.
**Entry point:** `/claude-tweaks:review #{n}` (or the `review` phase of `/claude-tweaks:flow #{n}`) on a diff that changes production code and its tests.
**Success state:** the summary's `### Code Review Findings (confirmed)` table lists the coverage gap once, at the production line the test should pin. A separate test-quality defect (a refactor-coupled or non-discriminating test) is listed at the test line.

## Steps

### 1. Run a review whose diff has a coverage gap — any session
- **URL:** `/claude-tweaks:review #{n}` at `review-effort` `medium` or above
- **Action:** let Step 3 dispatch lens 3f as a reproduction pair.
- **Should feel:** nothing different during the run. The change is in what each agent is told, not in how long the review takes or what it asks.
- **Should understand:** each lens agent's prompt carries the coverage anchor rule next to the file-native `Path:Line` rule. A coverage gap (a missing test, a weak test, a missing assertion, or insufficient case coverage) is anchored at the production line the test should pin, never at the test file. A test-quality defect (refactor-coupled, non-discriminating, or polluting shared state) is anchored at the test line. The 3f Test Quality checklist restates the same rule where coverage questions are asked.
- **Red flags:** one agent reports the gap at the test's decorator line and its partner at the production line. The rule shows up inside the byte-pinned Calibration/Output-template block.

### 2. Read the confirmed findings — the review summary
- **URL:** the review summary's `### Code Review Findings (confirmed)` table
- **Action:** look for the coverage gap both agents found.
- **Should feel:** confident. The finding is confirmed because the two agents agreed, not because the reviewer had to override two unmatched entries.
- **Should understand:** `categorise-reproduction` matches on exact path plus line ±2 and a substance check, or line ±5 when the two findings' text agrees strongly (similarity at least 0.6, #2955). #3049 left the matcher unchanged; the prompt rule is what makes both agents report the same location. Two agents that anchor the same gap at the same production line now satisfy that rule. A pair that agrees on location but words the finding differently is a separate substance-match question this rule does not address.
- **Red flags:** the same coverage gap appears twice under `unconfirmed`, once per anchor. A coverage gap is confirmed only via the direct-verification override even though both agents found it.

## Origin
- Created during build of #3049. On a `medium`-effort review (plugin 6.136.0), both 3f agents found that a production guard was pinned only by a Spark-gated test. One anchored it at the test's decorator line, the other at the unguarded production line, so neither reproduced. All six 3a/3f findings landed `unconfirmed`. The fix added a coverage anchor rule to the lens dispatch prompt and the 3f checklist, and left the reproduction matcher unchanged.
- Related journeys: `keep-review-lenses-from-running-suites-3001.md` (the same dispatch prompt's read-only rule).
