---
files:
  - plugin/skills/review/review-effort-derivation.md
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/review/review-summary-template.md
---

# Review a Large Change at the Tier Its Diff Earns

**Persona:** a maintainer running `/claude-tweaks:review` on a record whose `risk:*`/`size:*` labels were set at shaping time, before the change grew.
**Goal:** a change much larger than its labels gets the review depth its measured diff earns, without anyone overriding the tier by hand.
**Entry point:** `/claude-tweaks:review #{n}` (or the `review` phase of `/claude-tweaks:flow #{n}`) with no effort token, on a labelled record.
**Success state:** the resolved `review-effort` tier is the higher of the label tier and the diff tier, and the summary line names both inputs whenever they differ.

## Steps

### 1. Labels undercut the diff — tier rises to the diff tier
- **URL:** Step 2.5 (Derive Review Effort), `review-effort-derivation.md` steps 2-4
- **Action:** the reviewer reads the record's labels (e.g. `risk:low` × `size:medium` → label tier `low`), runs the diff heuristic over Step 2's `git diff --stat` (e.g. 142 files touching a cross-package interface → risk proxy `medium` × size proxy `high` → diff tier `high`), and takes the higher.
- **Should feel:** automatic. Nobody has to notice the mismatch and override the tier by hand, as #4028's reviewer had to.
- **Should understand:** labels never lower a tier the diff already earns. A label far below the measured diff is the ambiguity Step 2.5's rule names, and it resolves upward. The proxies and the risk × size table are the same ones the no-label fallback always used.
- **Red flags:** a labelled record resolving to its label tier while its diff stat clears the 10-file / 300-line `high` threshold; Step 3 dispatching only the `low`-tier lens set (3b/3c) on a diff that size.

### 2. Read the summary line — both inputs named
- **URL:** Step 7 summary, `**Review effort:**` line
- **Action:** the maintainer reads `**Review effort:** high (derived from label low, diff heuristic high (risk:low × size:medium; {reasoning}))`.
- **Should feel:** self-explanatory. The line shows which input set the tier and what the other one said.
- **Should understand:** the both-inputs form appears whenever the two tiers differ, in either direction. When they agree, the line keeps the familiar `record labels: risk:{x} × size:{y}` form.
- **Red flags:** a tier above the label tier with only `record labels: …` as its source; a both-inputs line on a review whose label tier and diff tier agree.

## Origin
- Created during build of #4221. #4028 carried `risk:low` / `size:medium`, which derived `low` (lenses 3b and 3c only) for a 142-file, 5,733-line diff that included a 728-line PreToolUse hook. The reviewer raised the tier to `high` by hand. Step 2.5 now derives both tiers and takes the higher.
- Related journeys: `run-a-review-from-a-worktree-isolated-session-2956.md` (step 1 there is the label read this journey's step 1 starts from).
