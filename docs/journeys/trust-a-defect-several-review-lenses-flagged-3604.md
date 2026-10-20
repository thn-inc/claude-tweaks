---
files:
  - plugin/skills/review/step3-cross-lens-corroboration.md
  - plugin/skills/review/step3-lens-dispatch.md
  - plugin/skills/review/code-mode-steps.md
  - plugin/bin/lib/coordination.js
  - plugin/bin/review-coordination.js
---

# Trust a Defect Several Review Lenses Flagged

**Persona:** a maintainer whose record is scored `risk:medium` × `size:medium`. They run `/claude-tweaks:review` at the default `medium` effort, usually inside `/claude-tweaks:flow`. At that tier, lenses 3b, 3c, 3a and 3f each run as a reproduction pair, and there is no Step 3.5 debate.
**Goal:** if two or more different lenses independently report the same defect, it reaches Step 3 Routing as a `confirmed` finding. This holds even when neither lens's partner agent reproduced it, so the defect is not buried in the Review Console's Low-confidence section.
**Entry point:** `/claude-tweaks:review #{n}` at `review-effort: medium`, or the `review` phase of `/claude-tweaks:flow #{n}`.
**Success state:** the defect is routed at the highest severity any lens gave it. `decisions.md` carries one `AUTO … Cross-lens corroboration (medium tier): finding {path}:{line} reported independently by lenses {lens list}. Confirmed.` line, and the Wrap-Up Review Console does not also list that finding as Low-confidence.

## Steps

### 1. Run a medium-effort review where single agents of different lenses flag one defect — any session
- **URL:** `/claude-tweaks:review #{n}` with Step 2.5 resolving `medium`
- **Action:** let Step 3 dispatch its reproduction pairs and categorise each pair with `review-coordination.js categorise-reproduction`.
- **Should feel:** like the review is joining evidence across lenses. A real defect is not dropped because each lens's partner happened to miss it.
- **Should understand:** after categorisation, the not-reproduced and share-a-location STAGED lines are held back at `medium`. Every lens's remaining `unconfirmed` findings are written to `review-{ctx-id}-unconfirmed-by-lens.json` and passed to `review-coordination.js corroborate-cross-lens`. Two findings match when they are from different lenses, on the same path, at most 5 lines apart, and with known substance similarity of at least 0.2. Every lens 3f vacuity finding is left out of the input, because only an executed run re-confirms one.
- **Red flags:** a defect reported by 3a, 3b and 3c each ends up only in the Low-confidence section. Two findings from the same lens corroborate each other. A vacuity claim gets promoted with no executed run.

### 2. Read the routing row and the decision line — Step 3 Routing and `decisions.md`
- **URL:** the review's Step 3 Routing table, and `{run-dir}/decisions.md` under `## /review`
- **Action:** find the promoted finding and its corroboration line.
- **Should feel:** traceable. The line names every lens that reported the finding, so the maintainer can check each lens's own evidence.
- **Should understand:** the routed row takes the most severe member's severity and Category. A `critical` security finding corroborated by a `low` convention finding stays `critical` and still interrupts. When members' severities fall in different buckets (critical/high versus medium/low/info), the line reads `…, severity contested (took the highest). Confirmed.` A `high` and a `critical` member share a bucket, so that row is not contested. A chain of matches never merges two distinct findings, so a cluster can produce several confirmed rows.
- **Red flags:** a `critical` routed as `low` and auto-applied. A distinct finding that appears only inside another row's `members`. A corroboration line that names one lens.

### 3. Check the Wrap-Up Review Console — end of the run
- **URL:** the Review Console's Low-confidence findings section
- **Action:** look for the corroborated finding.
- **Should feel:** consistent. A finding confirmed in routing is not also offered as low-confidence.
- **Should understand:** the console builds Low-confidence rows from `STAGED … not reproduced` lines (`plugin/bin/lib/console/resolve.js`'s `coordinationItems`). The pass writes those lines only for findings still `unconfirmed` after corroboration. If the call fails, nothing is promoted. The STAGED lines are written as before, plus one `SKIP … Cross-lens corroboration (skipped)` line.
- **Red flags:** the same `{path}:{line}` appears both as a confirmed routing row and as a Low-confidence console row. A failed corroboration call leaves no STAGED and no SKIP line.

## Origin
- Created during build of #3604. On #3258's medium-tier review, a superseded failed workflow run at the base sha marked a real PR failure as inherited. Lens agents 3a-B (high), 3b-B (low) and 3c-A (low) each reported it independently, but it stayed `unconfirmed` in every lens because each partner agent missed it. It was fixed only through the reviewing agent's manual Direct-verification override.
- Related journeys: `keep-review-lenses-from-running-suites-3001.md` (the same medium-tier fan-out), `ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md` (how this build's severity and chain-carving rulings reach the console).
