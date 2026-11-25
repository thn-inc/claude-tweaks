---
files:
  - plugin/skills/review/step3-debate-and-refutation.md
  - plugin/skills/_shared/multi-agent-coordination.md
  - plugin/bin/lib/coordination.js
  - plugin/bin/review-coordination.js
  - plugin/bin/lib/console/resolve.js
---

# Debate Only Same-Defect Overlaps in a Review

**Persona:** a maintainer running `/claude-tweaks:review` at `high` effort or above, usually inside `/claude-tweaks:flow`. At that tier, Step 3.5 Cross-Lens Debate runs after each lens's reproduction pair.
**Goal:** debate judges are dispatched only for two lenses that disagree about the same defect. Unrelated findings that happen to sit within five lines of each other do not each cost a pair of Frontier judges.
**Entry point:** `/claude-tweaks:review #{n}` with Step 2.5 resolving `high`, `xhigh` or `max`, or the `review` phase of `/claude-tweaks:flow #{n}` on a record scored high enough to reach that tier.
**Success state:**
- Each debated pair is two findings whose substance score is at least 0.2 (`SUBSTANCE_SIMILARITY_MIN`).
- Every other nearby pair with differing severity gets one `AUTO … Debate skipped: proximity coincidence …` line in `decisions.md`, and its two findings carry on in their own buckets.

## Steps

### 1. Detect overlap across lenses — Step 3.5 item 1
- **URL:** `review-coordination.js detect-overlap {findings-by-lens.json}`
- **Action:** let the review write each lens's findings to the session temp file and call `detect-overlap`.
- **Should feel:** like the overlap list already knows which pairs are worth arguing about. The orchestrator does not have to judge it pair by pair.
- **Should understand:**
  - Every pair `{lensA, lensB, findingA, findingB}` now also carries `substanceScore` and `substanceMatch`.
  - `substanceScore` is the token-Jaccard similarity of the two finding texts. It is `null` when either text is missing.
  - `substanceMatch` is `true` only when the score is at least 0.2. This is the same threshold reproduction pairing and cross-lens corroboration use.
- **Red flags:**
  - A pair without the two fields.
  - `substanceMatch: true` on a pair whose finding text is missing.

### 2. Filter to contradictions and dispatch debate — Step 3.5 items 2 and 3
- **URL:** the review's Step 3.5 debate dispatches
- **Action:** watch which pairs get a pair of debate judges.
- **Should feel:** proportionate. On a short diff, 32 overlap pairs with 17 severity mismatches should cost 2 debates, not 34 judges (#4556's review).
- **Should understand:**
  - A pair is debated only when its severities differ and its `substanceMatch` is `true`.
  - A pair whose severities differ but whose `substanceMatch` is `false` is a proximity coincidence. It gets no debate and one `AUTO {HH:MM:SS} — Debate skipped: proximity coincidence — lens "{lensA}" finding {pathA}:{lineA} and lens "{lensB}" finding {pathB}:{lineB} (substance score {score or "unknown"} below 0.2); both keep their own buckets (no debate). Reversibility: high.` line.
  - Pairs whose severities match are not debated, as before.
- **Red flags:**
  - Debate judges dispatched for two findings that describe different defects.
  - A coincidence pair with no log line, or logged twice.
  - A paraphrase of one defect skipped as a coincidence.

### 3. Follow the coincidence findings onward — Step 3.7, refutation, routing
- **URL:** the Per-Candidate Refutation Pass, Step 3.7's tiebreak, and Step 3 Routing
- **Action:** trace both findings of a coincidence pair.
- **Should feel:** as if the overlap never happened. Each finding keeps the treatment its own reproduction result earned.
- **Should understand:**
  - A `confirmed` coincidence finding goes on to the Per-Candidate Refutation Pass and Step 3 Routing.
  - An `unconfirmed` one goes on to Step 3.7's tiebreak.
  - Neither is `contested`.
- **Red flags:**
  - A `confirmed` finding sent to a Step 3.7 tiebreak judge.
  - A coincidence finding missing from routing.

### 4. Check the Wrap-Up Review Console — end of the run
- **URL:** the Review Console's Contested and Low-confidence sections
- **Action:** look for the coincidence findings.
- **Should feel:** quiet. The skip line is a trace, not an item to approve.
- **Should understand:**
  - The console settles findings only from STAGED lines, a converged-positive `Debate: cross-lens disagreement on … converged positive` AUTO line (`DEBATE_CONVERGED_RE`), or an AUTO `… Confirmed.` line.
  - The coincidence line matches none of these. It neither opens nor settles anything.
- **Red flags:** a coincidence line that supersedes a finding's STAGED line, or that appears as its own console row.

## Origin
- Created during the build of #4747.
  - On #4556's high-tier review of a 40-line prose recipe, `detect-overlap` returned 32 pairs and 17 severity mismatches.
  - Only 2 of the mismatches were the same defect, and the reviewer had to rule by hand to debate only those.
  - The build reused `categoriseReproduction`'s substance threshold as the debate filter.
  - Coincidence findings are routed by bucket rather than all to Step 3.7. This is a contract-beats-spec ruling staged as `build-deviation-1`.
- Related journeys:
  - `trust-a-defect-several-review-lenses-flagged-3604.md` (the same substance threshold, used for corroboration at `medium`)
  - `confirm-paraphrased-findings-across-reproduction-pairs-3418.md` (how the 0.2 threshold was calibrated)
