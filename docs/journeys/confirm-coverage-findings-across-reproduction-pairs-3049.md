---
files:
  - plugin/skills/review/step3-lens-dispatch.md
---

# Confirm Coverage Findings Across Reproduction Pairs

**Persona:** a developer who runs `/claude-tweaks:review` (usually inside `/claude-tweaks:flow`) at `medium` effort or above on a change whose production guard is only exercised by a gated or missing test. They read the review summary to decide what to fix before merge.
**Goal:** when both agents of the 3f Test Quality reproduction pair find the same coverage gap, it lands as a `confirmed` finding in the review summary rather than as two `unconfirmed` entries that need the reviewer's override.
**Entry point:** `/claude-tweaks:review #{n}` (or the `review` phase of `/claude-tweaks:flow #{n}`) on a diff that changes production code and its tests.
**Success state:** the summary's `### Code Review Findings (confirmed)` table lists the coverage gap once, at the production line the test should pin, and that includes an existing test too weak or non-discriminating to catch its regression. A separate test-quality defect (a refactor-coupled test, or one polluting shared state) is listed at the test line.

## Steps

### 1. Run a review whose diff has a coverage gap — any session
- **URL:** `/claude-tweaks:review #{n}` at `review-effort` `medium` or above
- **Action:** let Step 3 dispatch lens 3f as a reproduction pair.
- **Should feel:** nothing different during the run. The change is in what each agent is told, not in how long the review takes or what it asks.
- **Should understand:** each lens agent's prompt carries the coverage anchor rule next to the file-native `Path:Line` rule. A coverage gap is anchored at the production line the test should pin, never at the test file. That covers a missing test, a missing case, and an existing test whose assertions cannot catch the regression it guards: a weak or missing assertion, or a non-discriminating fixture. A test-quality defect is a flaw in how the test is built that holds whatever it catches, such as a refactor-coupled test or one polluting shared state. It is anchored at the test line. A finding that fits both readings is a coverage gap (#3398). The 3f Test Quality checklist restates the same rule where coverage questions are asked.
- **Red flags:** one agent reports the gap at the test's decorator line and its partner at the production line. One agent calls a weak assertion "non-discriminating" and anchors it at the test line while its partner anchors the same finding at the production line (#3351's split). The rule shows up inside the byte-pinned Calibration/Output-template block.

### 2. Read the confirmed findings — the review summary
- **URL:** the review summary's `### Code Review Findings (confirmed)` table
- **Action:** look for the coverage gap both agents found.
- **Should feel:** confident. The finding is confirmed because the two agents agreed, not because the reviewer had to override two unmatched entries.
- **Should understand:** `categorise-reproduction` matches on exact path plus line ±2 and a substance check, or line ±5 when the two findings' text agrees strongly (similarity at least 0.6, #2955). #3049 left the matcher unchanged; the prompt rule is what makes both agents report the same location. Two agents that anchor the same gap at the same production line now satisfy that rule. A pair that agrees on location but words the finding differently is a separate substance-match question this rule does not address.
- **Red flags:** the same coverage gap appears twice under `unconfirmed`, once per anchor. A coverage gap is confirmed only via the direct-verification override even though both agents found it.

## Origin
- Created during build of #3049. On a `medium`-effort review (plugin 6.136.0), both 3f agents found that a production guard was pinned only by a Spark-gated test. One anchored it at the test's decorator line, the other at the unguarded production line, so neither reproduced. All six 3a/3f findings landed `unconfirmed`. The fix added a coverage anchor rule to the lens dispatch prompt and the 3f checklist, and left the reproduction matcher unchanged.
- Updated during build of #3398. On #3351's review, the two lists overlapped: "weak test / missing assertion" anchored at the production line, and "non-discriminating" at the test line. The same weak-assertion gap then split across a test file and a production file in both of lens 3f's pairs. The fix moves "an existing test whose assertions cannot catch the regression it guards" (weak or missing assertion, non-discriminating fixture) to the production-line side, narrows the test-line side to construction defects, and adds a tie-break. Both restatements say the same, and `tests/review-coverage-anchor-conformance.test.js` pins the lists as disjoint.
- Related journeys: `keep-review-lenses-from-running-suites-3001.md` (the same dispatch prompt's read-only rule).
